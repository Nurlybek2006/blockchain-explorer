import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run after builds and infra:up. This uses the configured real databases,
// broker, Redis and RPC; it never supplies a fake blockchain response.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(resolve(root, 'apps/api-gateway/package.json'));
const messagingRequire = createRequire(resolve(root, 'packages/messaging/package.json'));
const { parse } = apiRequire('dotenv');
const { Pool } = apiRequire('pg');
const { createClient } = messagingRequire('redis');
const amqp = messagingRequire('amqplib');
const env = {
  ...parse(await readFile(resolve(root, '.env'))),
  ...process.env,
  API_GATEWAY_PORT: '3300',
  INDEXER_PORT: '3301',
  PORTFOLIO_PORT: '3302',
  INDEXER_ENABLED: 'false',
  INDEXER_INTERNAL_URL: 'http://127.0.0.1:3301',
  PORTFOLIO_INTERNAL_URL: 'http://127.0.0.1:3302',
};
const apiUrl = 'http://127.0.0.1:3300';
const secretValues = new Set(Object.entries(env)
  .filter(([key]) => /SECRET|PASSWORD|TOKEN|URL/.test(key))
  .map(([, value]) => value)
  .filter((value) => typeof value === 'string' && value.length > 3));
const children = [];
const testEmails = new Set();
const testUserIds = new Set();
const testPortfolioIds = new Set();
const limitations = [];
let interrupted = false;
let completedSteps = 0;
let identity;
let portfolioDatabase;
let explorerDatabase;

process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

function redact(input) {
  let result = String(input);
  for (const value of Array.from(secretValues).sort((left, right) => right.length - left.length)) {
    result = result.split(value).join('[redacted]');
  }
  return result.replace(/(?:postgres(?:ql)?|amqps?|rediss?|https?):\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/\$2[aby]\$\d\d\$[A-Za-z0-9./]+/g, '[redacted-password-hash]');
}

function ensureRunning() {
  if (interrupted) throw new Error('Verification interrupted; cleaning up its own processes and rows');
  for (const service of children) {
    if (service.exited) throw new Error(`${service.name} exited unexpectedly (${service.exitCode ?? service.signal ?? 'spawn error'})`);
  }
}

async function step(name, action) {
  ensureRunning();
  await action();
  completedSteps += 1;
  console.log(`PASS ${name}`);
}

function noPasswordHash(value) {
  if (!value || typeof value !== 'object') return;
  assert(!Object.hasOwn(value, 'passwordHash'), 'Response exposed passwordHash');
  assert(!Object.hasOwn(value, 'password_hash'), 'Response exposed password_hash');
  for (const child of Object.values(value)) noPasswordHash(child);
}

async function http(method, path, expectedStatus, body, token, baseUrl = apiUrl) {
  ensureRunning();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const text = await response.text();
  let parsed;
  if (text) {
    try { parsed = JSON.parse(text); } catch { throw new Error(`${method} ${path}: non-JSON response`); }
  }
  noPasswordHash(parsed);
  if (parsed && typeof parsed === 'object') {
    for (const key of ['accessToken', 'refreshToken']) {
      if (typeof parsed[key] === 'string') secretValues.add(parsed[key]);
    }
  }
  assert.equal(response.status, expectedStatus, `${method} ${path}: expected ${expectedStatus}, received ${response.status}`);
  return parsed;
}

async function freePort(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; existing services will not be stopped`)));
    server.listen(port, '0.0.0.0', () => server.close((error) => error ? reject(error) : resolvePort()));
  });
}

function startService(name) {
  const entry = pathToFileURL(resolve(root, 'apps', name, 'dist/main.js')).href;
  // IPC reaches only the Node process spawned here. Emitting its registered Nest
  // signal handlers runs app.close() on Windows before Node exits.
  const wrapper = `process.on('message', message => {
    if (message && message.type === 'phase7-verification-stop') process.emit('SIGTERM', 'SIGTERM');
  }); await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
    cwd: resolve(root, 'apps', name), env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  const service = { name, child, exited: false, exitCode: null, signal: null, logs: '', spawnError: null };
  const capture = (chunk) => { service.logs = `${service.logs}${redact(chunk.toString())}`.slice(-16_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => { service.spawnError = redact(error.message); service.exited = true; });
  child.once('close', (code, signal) => { service.exited = true; service.exitCode = code; service.signal = signal; });
  children.push(service);
}

async function ready(name, url) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    ensureRunning();
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.service, name, 'Unexpected service on verification port');
        assert.equal(health.database, 'connected', `${name} database unhealthy`);
        if (name !== 'indexer-service') assert.equal(health.redis, 'connected', `${name} Redis unhealthy`);
        if (name === 'portfolio-service') assert.equal(health.rabbitmq, 'connected', 'Portfolio RabbitMQ unhealthy');
        return;
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await delay(250);
  }
  throw new Error(`${name} did not become healthy within 45 seconds`);
}

async function rpc(method, params = []) {
  const response = await fetch(env.ETHEREUM_RPC_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Configured Ethereum RPC returned HTTP ${response.status}`);
  const result = await response.json();
  if (!result || result.error || typeof result.result !== 'string' || !/^0x[0-9a-f]+$/i.test(result.result)) {
    throw new Error(`Configured Ethereum RPC did not return a valid ${method} result`);
  }
  return result.result;
}

async function register(label) {
  const email = `phase7-${label}-${randomUUID()}@example.com`;
  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  testEmails.add(email);
  secretValues.add(password);
  const response = await http('POST', '/auth/register', 201, { email: ` ${email.toUpperCase()} `, password, displayName: ' Verification User ' });
  assert(response?.user && typeof response.user.id === 'string', 'Register did not return user ID');
  testUserIds.add(response.user.id);
  assert.equal(response.user.email, email);
  assert.equal(response.user.displayName, 'Verification User');
  assert.equal(typeof response.accessToken, 'string');
  assert.equal(typeof response.refreshToken, 'string');
  return { ...response, email, password };
}

async function createPortfolio(user, name) {
  const walletAddress = `0x${randomBytes(20).toString('hex')}`;
  const response = await http('POST', '/portfolio', 201, { name, walletAddress: `0x${walletAddress.slice(2).toUpperCase()}` }, user.accessToken);
  assert.equal(typeof response?.id, 'string', 'Portfolio response missing ID');
  testPortfolioIds.add(response.id);
  assert.equal(response.walletAddress, walletAddress, 'Wallet must be normalized');
  assert.equal(response.chainId, Number(env.ETHEREUM_CHAIN_ID ?? 11155111));
  return response;
}

async function nativeHolding(user, item) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const holdings = await http('GET', `/portfolio/${item.id}/holdings`, 200, undefined, user.accessToken);
    assert(Array.isArray(holdings), 'Holdings response must be an array');
    const native = holdings.find((holding) => holding.assetKey === 'native:eth');
    if (native) {
      assert.equal(native.assetType, 'native');
      assert.equal(native.symbol, 'ETH');
      assert.equal(native.decimals, 18);
      assert.equal(native.tokenAddress, null);
      assert.equal(typeof native.balanceRaw, 'string');
      assert(/^\d+$/.test(native.balanceRaw), 'Native balance must preserve integer precision');
      assert.equal(typeof native.lastUpdatedBlock, 'string');
      const balance = BigInt(await rpc('eth_getBalance', [item.walletAddress, `0x${BigInt(native.lastUpdatedBlock).toString(16)}`]));
      assert.equal(native.balanceRaw, balance.toString(), 'Holding differs from real RPC balance at its recorded block');
      const padded = balance.toString().padStart(19, '0');
      const fraction = padded.slice(-18).replace(/0+$/, '');
      const expected = `${padded.slice(0, -18)}${fraction ? `.${fraction}` : ''}`;
      assert.equal(native.balanceFormatted, expected, 'ETH formatting lost precision');
      return;
    }
    await delay(500);
  }
  const worker = children.find((service) => service.name === 'portfolio-service');
  if (worker) console.error(`Captured portfolio worker output:\n${worker.logs.split('\n').slice(-20).join('\n')}`);
  let chain;
  try {
    chain = BigInt(await rpc('eth_chainId'));
  } catch (error) {
    limitations.push(`Native ETH initial sync unverified: ${redact(error instanceof Error ? error.message : error)}`);
    return;
  }
  assert.equal(chain, BigInt(env.ETHEREUM_CHAIN_ID ?? 11155111), 'Configured RPC chain differs from portfolio chain');
  throw new Error('Native ETH initial sync failed: real RPC is reachable, but no native holding appeared within 40 seconds');
}

async function stopServices() {
  const results = await Promise.allSettled(children.map(async (service) => {
    if (service.exited) return;
    const closed = new Promise((resolveClose) => service.child.once('close', resolveClose));
    if (service.child.connected) {
      service.child.send({ type: 'phase7-verification-stop' }, () => undefined);
    } else {
      service.child.kill('SIGTERM');
    }
    const graceful = await Promise.race([closed.then(() => true), delay(60_000, undefined, { ref: false }).then(() => false)]);
    if (!graceful) {
      service.child.kill('SIGKILL');
      await Promise.race([closed, delay(5000, undefined, { ref: false })]);
      throw new Error(`${service.name} required forced shutdown after 60 seconds`);
    }
  }));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

async function cleanup() {
  if (!identity || !portfolioDatabase) return;
  // Exact generated emails recover IDs if a request committed before its response
  // failed. No prefix query, wildcard deletion, queue drain or database reset.
  if (testEmails.size > 0) {
    const users = await identity.query('SELECT id FROM users WHERE email = ANY($1::text[])', [Array.from(testEmails)]);
    for (const user of users.rows) testUserIds.add(user.id);
  }
  if (testUserIds.size === 0) return;
  const owned = await portfolioDatabase.query('SELECT id FROM portfolios WHERE user_id = ANY($1::uuid[])', [Array.from(testUserIds)]);
  for (const item of owned.rows) testPortfolioIds.add(item.id);
  const ids = Array.from(testPortfolioIds);
  const failures = [];
  if (ids.length > 0) {
    const { BullMqFactory } = await import(pathToFileURL(resolve(root, 'packages/messaging/dist/index.js')).href);
    const queue = new BullMqFactory({ redisUrl: env.REDIS_URL }).createQueue(env.PORTFOLIO_QUEUE_NAME ?? 'portfolio-jobs');
    queue.on('error', () => undefined);
    try {
      for (const id of ids) {
        try {
          const job = await queue.getJob(`initial-${id}`);
          if (job) {
            assert.equal(job.data.portfolioId, id, 'Refusing to remove an unrelated queue job');
            await job.remove();
          }
        } catch (error) {
          failures.push(`Initial-sync job removal failed: ${redact(error instanceof Error ? error.message : error)}`);
        }
      }
    } finally {
      await queue.close();
    }
    const client = await portfolioDatabase.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM outbox_events WHERE aggregate_type = 'portfolio' AND aggregate_id = ANY($1::text[])", [ids]);
      await client.query('DELETE FROM portfolios WHERE id = ANY($1::uuid[]) AND user_id = ANY($2::uuid[])', [ids, Array.from(testUserIds)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  await identity.query('DELETE FROM users WHERE id = ANY($1::uuid[]) AND email = ANY($2::text[])', [Array.from(testUserIds), Array.from(testEmails)]);
  if (failures.length > 0) throw new Error(failures.join('; '));
  console.log('PASS cleanup exact generated users, portfolios, initial-sync jobs and outbox intents');
}

try {
  for (const key of ['IDENTITY_DATABASE_URL', 'EXPLORER_DATABASE_URL', 'PORTFOLIO_DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL', 'ETHEREUM_RPC_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!env[key]) throw new Error(`Missing required setting ${key}`);
  }
  await Promise.all([freePort(3300), freePort(3301), freePort(3302),
    ...['api-gateway', 'indexer-service', 'portfolio-service'].map((name) => access(resolve(root, 'apps', name, 'dist/main.js')))]);
  identity = new Pool({ connectionString: env.IDENTITY_DATABASE_URL, connectionTimeoutMillis: 5000 });
  portfolioDatabase = new Pool({ connectionString: env.PORTFOLIO_DATABASE_URL, connectionTimeoutMillis: 5000 });
  explorerDatabase = new Pool({ connectionString: env.EXPLORER_DATABASE_URL, connectionTimeoutMillis: 5000 });
  await step('real PostgreSQL / Redis / RabbitMQ connections', async () => {
    await Promise.all([identity.query('SELECT 1'), portfolioDatabase.query('SELECT 1'), explorerDatabase.query('SELECT 1')]);
    const redis = createClient({ url: env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    redis.on('error', () => undefined);
    try { await redis.connect(); assert.equal(await redis.ping(), 'PONG'); } finally { if (redis.isOpen) await redis.quit(); }
    const broker = await amqp.connect(env.RABBITMQ_URL, { timeout: 5000 });
    try { const channel = await broker.createChannel(); await channel.close(); } finally { await broker.close(); }
  });
  for (const name of ['indexer-service', 'portfolio-service', 'api-gateway']) startService(name);
  await step('three built services start healthy with chain scanning disabled', async () => {
    await Promise.all([ready('indexer-service', env.INDEXER_INTERNAL_URL), ready('portfolio-service', env.PORTFOLIO_INTERNAL_URL), ready('api-gateway', apiUrl)]);
  });

  let first;
  let second;
  await step('register two users, normalize fields and reject duplicate registration', async () => {
    first = await register('owner');
    second = await register('other');
    await http('POST', '/auth/register', 409, { email: first.email, password: first.password });
  });
  await step('login and protected profile, generic invalid credentials', async () => {
    const login = await http('POST', '/auth/login', 200, { email: first.email, password: first.password });
    assert(login.user.lastLoginAt, 'Login did not update lastLoginAt');
    first = { ...first, ...login };
    const profile = await http('GET', '/users/me', 200, undefined, first.accessToken);
    assert.equal(profile.id, first.user.id);
    const incorrect = await http('POST', '/auth/login', 401, { email: first.email, password: 'WrongPassword123!' });
    const missing = await http('POST', '/auth/login', 401, { email: `missing-${randomUUID()}@example.com`, password: 'WrongPassword123!' });
    assert.equal(incorrect.message, missing.message, 'Login leaked account existence');
  });
  await step('refresh rotation and committed family revocation after reuse', async () => {
    const oldToken = first.refreshToken;
    const rotated = await http('POST', '/auth/refresh', 200, { refreshToken: oldToken });
    assert.notEqual(rotated.refreshToken, oldToken);
    await http('POST', '/auth/refresh', 401, { refreshToken: oldToken });
    const tokenHash = createHash('sha256').update(rotated.refreshToken).digest('hex');
    const revoked = await identity.query('SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2', [tokenHash, first.user.id]);
    assert.equal(revoked.rows.length, 1);
    assert(revoked.rows[0].revoked_at, 'Replay family revocation was rolled back');
    await http('POST', '/auth/refresh', 401, { refreshToken: rotated.refreshToken });
    const login = await http('POST', '/auth/login', 200, { email: first.email, password: first.password });
    first = { ...first, ...login };
  });
  await step('JWT requirements, token separation and request validation', async () => {
    await http('GET', '/users/me', 401);
    await http('GET', '/portfolio', 401);
    await http('POST', '/auth/logout-all', 401);
    await http('GET', '/users/me', 401, undefined, first.refreshToken);
    await http('POST', '/auth/refresh', 401, { refreshToken: first.accessToken });
    await http('POST', '/auth/register', 400, { email: 'bad-email', password: 'short' });
    await http('POST', '/auth/register', 400, { email: `utf8-${randomUUID()}@example.com`, password: 'Ж'.repeat(37) });
    await http('GET', '/portfolio/not-a-uuid', 400, undefined, first.accessToken);
    await http('GET', '/portfolio?page=0', 400, undefined, first.accessToken);
    await http('POST', '/portfolio', 400, { name: 'Invalid', walletAddress: 'invalid' }, first.accessToken);
    await http('POST', '/portfolio', 400, { name: 'Spoof', walletAddress: `0x${randomBytes(20).toString('hex')}`, userId: second.user.id }, first.accessToken);
    await http('GET', `/internal/portfolios?userId=${first.user.id}`, 401, undefined, undefined, env.PORTFOLIO_INTERNAL_URL);
  });

  let ownPortfolios;
  let otherPortfolio;
  await step('concurrent first creates produce one primary, multiple wallets and duplicate rejection', async () => {
    ownPortfolios = await Promise.all([createPortfolio(first, 'Concurrent A'), createPortfolio(first, 'Concurrent B')]);
    assert.equal(ownPortfolios.filter((item) => item.isPrimary).length, 1, 'Concurrent first creates produced multiple primary portfolios');
    ownPortfolios.push(await createPortfolio(first, 'Third Portfolio'));
    otherPortfolio = await createPortfolio(second, 'Other Owner');
    await http('POST', '/portfolio', 409, { name: 'Duplicate', walletAddress: ownPortfolios[0].walletAddress }, first.accessToken);
    const list = await http('GET', '/portfolio', 200, undefined, first.accessToken);
    assert.equal(list.total, 3);
    assert.equal(list.items.length, 3);
    assert.equal(list.items.filter((item) => item.isPrimary).length, 1);
    assert(!list.items.some((item) => item.id === otherPortfolio.id), 'List exposed another user portfolio');
    const detail = await http('GET', `/portfolio/${ownPortfolios[0].id}`, 200, undefined, first.accessToken);
    assert(Array.isArray(detail.holdings));
  });
  await step('ownership blocks detail, holdings, rename and archive for another user', async () => {
    const id = ownPortfolios[0].id;
    await http('GET', `/portfolio/${id}`, 404, undefined, second.accessToken);
    await http('GET', `/portfolio/${id}/holdings`, 404, undefined, second.accessToken);
    await http('PATCH', `/portfolio/${id}`, 404, { name: 'Unauthorized rename' }, second.accessToken);
    await http('DELETE', `/portfolio/${id}`, 404, undefined, second.accessToken);
    await http('GET', `/portfolio/${otherPortfolio.id}`, 404, undefined, first.accessToken);
  });
  const primary = ownPortfolios.find((item) => item.isPrimary);
  assert(primary, 'Created portfolios missing primary');
  const previousLimitations = limitations.length;
  await nativeHolding(first, primary);
  if (limitations.length === previousLimitations) {
    completedSteps += 1;
    console.log('PASS BullMQ initial native ETH holding equals real RPC balance with exact decimal formatting');
  } else {
    console.log(`LIMITATION ${limitations.at(-1)}`);
  }
  await step('rename, archive hides data and reassigns primary', async () => {
    const renamed = await http('PATCH', `/portfolio/${primary.id}`, 200, { name: ' Renamed Portfolio ' }, first.accessToken);
    assert.equal(renamed.name, 'Renamed Portfolio');
    await http('DELETE', `/portfolio/${primary.id}`, 204, undefined, first.accessToken);
    await http('GET', `/portfolio/${primary.id}`, 404, undefined, first.accessToken);
    await http('GET', `/portfolio/${primary.id}/holdings`, 404, undefined, first.accessToken);
    const list = await http('GET', '/portfolio', 200, undefined, first.accessToken);
    assert.equal(list.total, 2);
    assert.equal(list.items.filter((item) => item.isPrimary).length, 1, 'Archive did not reassign primary');
  });
  await step('logout and logout-all make refresh sessions unusable', async () => {
    await http('POST', '/auth/logout', 204, { refreshToken: second.refreshToken });
    await http('POST', '/auth/refresh', 401, { refreshToken: second.refreshToken });
    await http('POST', '/auth/logout-all', 204, undefined, first.accessToken);
    await http('POST', '/auth/refresh', 401, { refreshToken: first.refreshToken });
    const active = await identity.query('SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [first.user.id]);
    assert.equal(active.rows[0].count, 0, 'Logout-all left an active refresh session');
  });
  console.log(`Phase 7 real integration verification: ${completedSteps} checks passed${limitations.length ? `; ${limitations.length} unresolved limitation(s)` : ''}.`);
  if (limitations.length > 0) process.exitCode = 2;
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${redact(error instanceof Error ? error.message : error)}`);
  for (const service of children) {
    if (service.exited || completedSteps < 2) {
      console.error(`Captured ${service.name} startup output:\n${service.logs.split('\n').slice(-20).join('\n')}`);
    }
  }
} finally {
  let childrenClosed = false;
  try { await stopServices(); childrenClosed = true; console.log('PASS own service processes shut down'); } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL shutdown: ${redact(error instanceof Error ? error.message : error)}`);
    childrenClosed = children.every((service) => service.exited);
  }
  if (childrenClosed) {
    try { await cleanup(); } catch (error) {
      process.exitCode = 1;
      console.error(`FAIL cleanup: ${redact(error instanceof Error ? error.message : error)}`);
    }
  } else {
    process.exitCode = 1;
    console.error('FAIL cleanup skipped because an owned child is still running; generated rows preserved for inspection');
  }
  const pools = [identity, portfolioDatabase, explorerDatabase].filter(Boolean);
  const closed = await Promise.allSettled(pools.map((pool) => pool.end()));
  for (const result of closed) if (result.status === 'rejected') {
    process.exitCode = 1;
    console.error(`FAIL closing database connection: ${redact(result.reason)}`);
  }
}
