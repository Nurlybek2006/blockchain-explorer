import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real PostgreSQL/Redis/RabbitMQ and built services; deterministic provider/RPC fixtures.
// Every database and broker/cache/queue namespace belongs only to this invocation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(resolve(root, 'apps/api-gateway/package.json'));
const portfolioRequire = createRequire(resolve(root, 'apps/portfolio-service/package.json'));
const messagingRequire = createRequire(resolve(root, 'packages/messaging/package.json'));
const { parse } = apiRequire('dotenv');
const { Pool } = apiRequire('pg');
const { drizzle } = portfolioRequire('drizzle-orm/node-postgres');
const { migrate } = portfolioRequire('drizzle-orm/node-postgres/migrator');
const { createClient } = messagingRequire('redis');
const amqp = messagingRequire('amqplib');
const sourceEnv = { ...parse(await readFile(resolve(root, '.env'))), ...process.env };
const runId = randomBytes(12).toString('hex');
const databaseMarker = `phase8-verification:${runId}`;
const cachePrefix = `phase8:${runId}`;
const queueName = `phase8-${runId}-jobs`;
const exchangeName = `phase8.${runId}.events`;
const consumerQueue = `phase8.${runId}.portfolio`;
const env = {
  ...sourceEnv,
  NODE_ENV: 'test',
  API_GATEWAY_PORT: '3400', INDEXER_PORT: '3401', PORTFOLIO_PORT: '3402',
  INDEXER_ENABLED: 'false',
  INDEXER_INTERNAL_URL: 'http://127.0.0.1:3401', PORTFOLIO_INTERNAL_URL: 'http://127.0.0.1:3402',
  INTERNAL_SERVICE_TOKEN: randomBytes(40).toString('base64url'),
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'), JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
  BCRYPT_ROUNDS: '10', ETHEREUM_CHAIN_ID: '11155111',
  CACHE_PREFIX: cachePrefix, PORTFOLIO_QUEUE_NAME: queueName,
  RABBITMQ_EXCHANGE: exchangeName, PORTFOLIO_EVENTS_QUEUE: consumerQueue,
  COINGECKO_API_KEY: '', COINGECKO_MAX_RETRIES: '0', COINGECKO_TIMEOUT_MS: '2000',
  COINGECKO_REQUESTS_PER_SECOND: '20', COINGECKO_MAX_CONCURRENT_REQUESTS: '2',
  PRICE_CACHE_TTL_SECONDS: '1', PRICE_UNAVAILABLE_CACHE_TTL_SECONDS: '1', PRICE_STALE_AFTER_SECONDS: '3600',
  PRICE_REFRESH_INTERVAL_MS: '86400000', PORTFOLIO_SNAPSHOT_INTERVAL_MS: '86400000',
  PRICE_SCHEDULER_ENABLED: 'false',
  WHALE_DEFAULT_THRESHOLD_USD: '100000',
  RPC_MAX_RETRIES: '0', RPC_TIMEOUT_MS: '2000', RPC_REQUESTS_PER_SECOND: '20',
};
const apiUrl = 'http://127.0.0.1:3400';
const tokenAddress = `0x${'a'.repeat(40)}`;
const unknownToken = `0x${'d'.repeat(40)}`;
const activityWallet = `0x${randomBytes(20).toString('hex')}`;
const secrets = new Set(Object.entries({ ...sourceEnv, ...env })
  .filter(([key]) => /SECRET|PASSWORD|TOKEN|URL/.test(key)).map(([, value]) => value)
  .filter((value) => typeof value === 'string' && value.length > 3));
const children = [];
const databases = [];
const fixturePrices = new Map([[tokenAddress, '1']]);
let fixtureEthPrice = '99';
let fixtureTimestamp = Math.floor(Date.now() / 1000);
let fixtureServer;
let redis;
let broker;
let publishChannel;
let queue;
let portfolioDb;
let interrupted = false;
let checks = 0;
process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

function redact(input) {
  let text = String(input);
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(value).join('[redacted]');
  return text.replace(/(?:postgres(?:ql)?|amqps?|rediss?|https?):\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/\$2[aby]\$\d\d\$[A-Za-z0-9./]+/g, '[redacted-password-hash]');
}

function running() {
  if (interrupted) throw new Error('Verification interrupted');
  for (const service of children) if (service.exited) throw new Error(`${service.name} exited unexpectedly`);
}

async function check(label, action) {
  running();
  await action();
  checks += 1;
  console.log(`PASS ${label}`);
}

function assertNoPassword(value) {
  if (value === null || typeof value !== 'object') return;
  assert(!Object.hasOwn(value, 'passwordHash') && !Object.hasOwn(value, 'password_hash'), 'Password hash exposed');
  for (const child of Object.values(value)) assertNoPassword(child);
}

async function request(baseUrl, method, path, status, body, accessToken, internal = false) {
  running();
  const response = await fetch(`${baseUrl}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      ...(internal ? { 'x-internal-service-token': env.INTERNAL_SERVICE_TOKEN } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  if (text) {
    try { parsed = JSON.parse(text); } catch { throw new Error(`${method} ${path}: non-JSON response`); }
  }
  assertNoPassword(parsed);
  for (const key of ['accessToken', 'refreshToken']) if (typeof parsed?.[key] === 'string') secrets.add(parsed[key]);
  assert.equal(response.status, status, `${method} ${path}: expected ${status}, received ${response.status}`);
  return parsed;
}
const api = (method, path, status, body, user) => request(apiUrl, method, path, status, body, user?.accessToken);
const internal = (method, path, status, body) => request(env.PORTFOLIO_INTERNAL_URL, method, path, status, body, undefined, true);

async function eventually(label, action, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    running();
    const result = await action();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`${label} timed out`);
}

async function freePort(port) {
  await new Promise((accept, reject) => {
    const server = createTcpServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; no existing process will be stopped`)));
    server.listen(port, '0.0.0.0', () => server.close((error) => error ? reject(error) : accept()));
  });
}

function databaseUrl(original, name) {
  const url = new URL(original);
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'Expected PostgreSQL URL');
  url.pathname = `/${name}`;
  return url.toString();
}

function databaseIdentifier(name) {
  assert(/^phase8_[a-f0-9]{24}_(identity|explorer|portfolio)$/.test(name), 'Refusing database operation outside this generated namespace');
  assert(name.startsWith(`phase8_${runId}_`), 'Refusing database operation for another run');
  return `"${name}"`;
}

async function createTestDatabase(app, role, configKey) {
  const name = `phase8_${runId}_${role}`;
  const identifier = databaseIdentifier(name);
  const admin = new Pool({ connectionString: databaseUrl(sourceEnv[configKey], 'postgres'), connectionTimeoutMillis: 5000 });
  const managed = { name, admin, pool: null, created: false, marked: false };
  databases.push(managed);
  await admin.query(`CREATE DATABASE ${identifier}`);
  managed.created = true;
  // A marker plus the in-memory successful CREATE record proves cleanup ownership.
  await admin.query(`COMMENT ON DATABASE ${identifier} IS '${databaseMarker}'`);
  managed.marked = true;
  env[configKey] = databaseUrl(sourceEnv[configKey], name);
  secrets.add(env[configKey]);
  managed.pool = new Pool({ connectionString: env[configKey], connectionTimeoutMillis: 5000 });
  await migrate(drizzle(managed.pool), { migrationsFolder: resolve(root, 'apps', app, 'src/database/migrations') });
  if (role === 'portfolio') portfolioDb = managed.pool;
}

function encodeAbiText(value) {
  const hex = Buffer.from(value).toString('hex');
  return `0x${'20'.padStart(64, '0')}${(hex.length / 2).toString(16).padStart(64, '0')}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;
}

async function startFixtureServer() {
  fixtureServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/rpc') {
        let text = '';
        for await (const chunk of req) {
          text += chunk.toString();
          if (text.length > 1_048_576) throw new Error('Fixture RPC request too large');
        }
        const input = JSON.parse(text);
        let result;
        if (input.method === 'eth_chainId') result = '0xaa36a7';
        else if (input.method === 'eth_blockNumber') result = '0x2710';
        else if (input.method === 'eth_getBalance') result = `0x${(2n * 10n ** 18n).toString(16)}`;
        else if (input.method === 'eth_call') {
          const data = input.params?.[0]?.data ?? '';
          if (data.startsWith('0x313ce567')) result = `0x${'12'.padStart(64, '0')}`;
          else if (data.startsWith('0x70a08231')) result = `0x${'0'.repeat(64)}`;
          else if (data.startsWith('0x95d89b41')) result = encodeAbiText('FIX');
          else if (data.startsWith('0x06fdde03')) result = encodeAbiText('Fixture Token');
        }
        res.end(JSON.stringify(result === undefined
          ? { jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'Unsupported fixture RPC method' } }
          : { jsonrpc: '2.0', id: input.id, result }));
        return;
      }
      const eth = url.pathname === '/api/v3/simple/price';
      const token = url.pathname === '/api/v3/simple/token_price/ethereum';
      if (!eth && !token) { res.statusCode = 404; res.end('{}'); return; }
      const key = eth ? 'ethereum' : url.searchParams.get('contract_addresses')?.toLowerCase();
      const price = eth ? fixtureEthPrice : fixturePrices.get(key);
      if (price === undefined) { res.end('{}'); return; }
      // Numeric lexemes remain JSON numbers with all digits; no Number round trip.
      fixtureTimestamp = Math.max(fixtureTimestamp + 1, Math.floor(Date.now() / 1000));
      res.end(`{${JSON.stringify(key)}:{"usd":${price},"usd_24h_change":1.25000000,"usd_market_cap":1234567890.01,"last_updated_at":${fixtureTimestamp}}}`);
    } catch {
      res.statusCode = 500;
      res.end('{"error":"Fixture request failed"}');
    }
  });
  await new Promise((accept, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', accept);
  });
  const address = fixtureServer.address();
  assert(address && typeof address === 'object', 'Fixture server did not bind');
  env.ETHEREUM_RPC_URL = `http://127.0.0.1:${address.port}/rpc`;
  env.COINGECKO_BASE_URL = `http://127.0.0.1:${address.port}/api/v3`;
}

function startService(name) {
  const entry = pathToFileURL(resolve(root, 'apps', name, 'dist/main.js')).href;
  const wrapper = `process.on('message', message => {
    if (message && message.type === 'phase8-verification-stop') process.emit('SIGTERM', 'SIGTERM');
  }); await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
    cwd: resolve(root, 'apps', name), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const service = { name, child, exited: false, logs: '' };
  const capture = (chunk) => { service.logs = `${service.logs}${redact(chunk.toString())}`.slice(-20_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => { service.exited = true; capture(error.message); });
  child.once('close', () => { service.exited = true; });
  children.push(service);
}

async function ready(name, base) {
  await eventually(`${name} readiness`, async () => {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) return false;
      const state = await response.json();
      assert.equal(state.service, name);
      assert.equal(state.database, 'connected');
      if (name !== 'indexer-service') assert.equal(state.redis, 'connected');
      if (name === 'portfolio-service') assert.equal(state.rabbitmq, 'connected');
      return true;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      return false;
    }
  }, 45_000);
}

async function register(label) {
  const email = `phase8-${label}-${runId}@example.com`;
  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  secrets.add(password);
  const result = await api('POST', '/auth/register', 201, { email, password, displayName: 'Fixture Verification' });
  assert.equal(typeof result?.user?.id, 'string');
  return { ...result, email, password };
}

async function refreshPrice(assetKey) {
  return internal('POST', '/internal/prices/refresh', 201, { assetKey });
}

async function completedJob(name, data) {
  const job = await queue.add(name, data, { jobId: `verify-${randomUUID()}` });
  return eventually(`${name} completion`, async () => {
    const state = await job.getState();
    if (state === 'failed') throw new Error(`${name} failed: ${redact(job.failedReason ?? 'worker failure')}`);
    return state === 'completed';
  });
}

function transfer(amountRaw, token = tokenAddress) {
  return {
    id: randomUUID(), type: 'token.transfer.indexed.v1', version: 1, producer: 'phase8-fixture-indexer', occurredAt: new Date().toISOString(),
    payload: { chainId: 11155111, networkName: 'sepolia', blockNumber: '10000', transactionHash: `0x${randomBytes(32).toString('hex')}`,
      transactionIndex: 1, logIndex: 2, tokenAddress: token, fromAddress: activityWallet, toAddress: `0x${'c'.repeat(40)}`,
      amountRaw, tokenDecimals: 18, tokenSymbol: 'FIX' },
  };
}

async function publish(event) {
  await new Promise((accept, reject) => {
    publishChannel.publish(exchangeName, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true, contentType: 'application/json', messageId: event.id,
    }, (error) => error ? reject(error) : accept());
  });
}

async function eventCount(alertId) {
  const result = await portfolioDb.query('SELECT count(*)::int AS count FROM alert_events WHERE alert_id = $1', [alertId]);
  return result.rows[0].count;
}

async function stopServices() {
  const outcomes = await Promise.allSettled(children.map(async (service) => {
    if (service.exited) return;
    const closed = new Promise((accept) => service.child.once('close', accept));
    if (service.child.connected) service.child.send({ type: 'phase8-verification-stop' }, () => undefined);
    else service.child.kill('SIGTERM');
    const graceful = await Promise.race([closed.then(() => true), delay(45_000, undefined, { ref: false }).then(() => false)]);
    if (!graceful) {
      service.child.kill('SIGKILL');
      await Promise.race([closed, delay(5000, undefined, { ref: false })]);
      throw new Error(`${service.name} required forced shutdown`);
    }
  }));
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
}

async function cleanupRedis() {
  if (!redis?.isOpen) return;
  const prefixes = [`${cachePrefix}:`, `bull:${queueName}:`];
  assert(prefixes.every((prefix) => prefix.includes(runId)), 'Invalid cleanup Redis namespace');
  for (const prefix of prefixes) {
    for await (const scanned of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      const keys = Array.isArray(scanned) ? scanned : [scanned];
      assert(keys.every((key) => typeof key === 'string' && key.startsWith(prefix)), 'Refusing unrelated Redis key');
      if (keys.length) await redis.del(keys);
    }
  }
}

async function cleanupBroker() {
  if (!broker) return;
  for (const [kind, name] of [['queue', consumerQueue], ['queue', `${consumerQueue}.dlq`], ['exchange', exchangeName], ['exchange', `${exchangeName}.dlx`]]) {
    assert(name.startsWith(`phase8.${runId}.`), 'Refusing unrelated broker topology');
    const channel = await broker.createChannel();
    channel.on('error', () => undefined);
    try {
      if (kind === 'queue') await channel.deleteQueue(name);
      else await channel.deleteExchange(name);
    } catch (error) {
      if (error?.code !== 404) throw error;
    } finally { await channel.close().catch(() => undefined); }
  }
}

async function cleanupDatabases() {
  for (const database of databases) if (database.pool) await database.pool.end();
  for (const database of databases) {
    if (!database.created) continue;
    const identifier = databaseIdentifier(database.name);
    // Database comments live in pg_shdescription because pg_database is a shared catalog.
    const proof = await database.admin.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", [database.name]);
    assert(database.marked && proof.rows.length === 1 && proof.rows[0].marker === databaseMarker, 'Refusing database drop without this run ownership marker');
    await database.admin.query(`DROP DATABASE ${identifier}`);
    database.created = false;
  }
}

try {
  console.log('Phase 8 isolated fixture integration: real PostgreSQL/Redis/RabbitMQ; deterministic local CoinGecko and Ethereum RPC fixtures.');
  for (const key of ['IDENTITY_DATABASE_URL', 'EXPLORER_DATABASE_URL', 'PORTFOLIO_DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL']) {
    if (!sourceEnv[key]) throw new Error(`Missing required infrastructure setting ${key}`);
  }
  await Promise.all([freePort(3400), freePort(3401), freePort(3402),
    ...['api-gateway', 'indexer-service', 'portfolio-service'].map((name) => access(resolve(root, 'apps', name, 'dist/main.js')))]);
  await check('three isolated PostgreSQL databases created and existing migrations applied', async () => {
    await createTestDatabase('api-gateway', 'identity', 'IDENTITY_DATABASE_URL');
    await createTestDatabase('indexer-service', 'explorer', 'EXPLORER_DATABASE_URL');
    await createTestDatabase('portfolio-service', 'portfolio', 'PORTFOLIO_DATABASE_URL');
  });
  await check('isolated Redis and RabbitMQ namespaces connected', async () => {
    redis = createClient({ url: env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    redis.on('error', () => undefined);
    await redis.connect();
    assert.equal(await redis.ping(), 'PONG');
    broker = await amqp.connect(env.RABBITMQ_URL, { timeout: 5000 });
    broker.on('error', () => undefined);
    publishChannel = await broker.createConfirmChannel();
    publishChannel.on('error', () => undefined);
    const { BullMqFactory } = await import(pathToFileURL(resolve(root, 'packages/messaging/dist/index.js')).href);
    queue = new BullMqFactory({ redisUrl: env.REDIS_URL }).createQueue(queueName);
    queue.on('error', () => undefined);
    await startFixtureServer();
  });
  for (const name of ['indexer-service', 'portfolio-service', 'api-gateway']) startService(name);
  await check('three services healthy with indexing disabled and isolated dependencies', async () => {
    await Promise.all([ready('indexer-service', env.INDEXER_INTERNAL_URL), ready('portfolio-service', env.PORTFOLIO_INTERNAL_URL), ready('api-gateway', apiUrl)]);
  });
  let first;
  let second;
  await check('register/login/profile and distinct owners through real auth storage', async () => {
    first = await register('owner');
    second = await register('foreign');
    const login = await api('POST', '/auth/login', 200, { email: first.email, password: first.password });
    first = { ...first, ...login };
    const profile = await api('GET', '/users/me', 200, undefined, first);
    assert.equal(profile.id, first.user.id);
  });
  await check('public validation, JWT protection and internal token boundary', async () => {
    await api('GET', '/watchlists', 401);
    await api('GET', '/alerts', 401);
    await api('POST', '/watchlists', 400, { name: 'Spoof', userId: second.user.id }, first);
    await api('POST', '/alerts', 400, { type: 'whale', userId: second.user.id }, first);
    await api('GET', '/watchlists/not-a-uuid', 400, undefined, first);
    await request(env.PORTFOLIO_INTERNAL_URL, 'GET', '/internal/prices/eth', 401);
  });
  await check('lossless CoinGecko ETH/token prices persist current rows and snapshots', async () => {
    const eth = await refreshPrice('native:eth');
    assert.match(eth.priceUsd, /^99(?:\.0+)?$/);
    const token = await refreshPrice(`erc20:${tokenAddress}`);
    assert.match(token.priceUsd, /^1(?:\.0+)?$/);
    const stored = await portfolioDb.query('SELECT usd_price::text FROM prices WHERE asset_key = $1', ['native:eth']);
    assert.equal(stored.rows[0].usd_price, '99.000000000000000000');
    const count = await portfolioDb.query('SELECT count(*)::int AS count FROM price_snapshots');
    assert(count.rows[0].count >= 2);
    assert.match((await api('GET', '/prices/eth', 200)).priceUsd, /^99(?:\.0+)?$/);
    await api('GET', '/prices/token/invalid', 400);
  });
  let portfolio;
  await check('portfolio initial job stores fixture native 2 ETH without precision loss', async () => {
    portfolio = await api('POST', '/portfolio', 201, { name: 'Fixture Portfolio', walletAddress: `0x${randomBytes(20).toString('hex')}` }, first);
    const native = await eventually('native ETH holding', async () => {
      const rows = await api('GET', `/portfolio/${portfolio.id}/holdings`, 200, undefined, first);
      return rows.find((row) => row.assetKey === 'native:eth');
    });
    assert.equal(native.balanceRaw, '2000000000000000000');
    assert.equal(native.balanceFormatted, '2');
    await eventually('initial sync completion', async () => {
      const initial = await queue.getJob(`initial-${portfolio.id}`);
      return initial && await initial.getState() === 'completed';
    });
  });
  await check('exact valuation and cross-owner valuation/history/analytics denial', async () => {
    const valued = await api('GET', `/portfolio/${portfolio.id}/valuation`, 200, undefined, first);
    assert.equal(valued.summary.totalValueUsd, '198');
    assert.equal(valued.summary.complete, true);
    assert.equal(valued.holdings[0].valueUsd, '198');
    for (const path of ['valuation', 'history', 'analytics']) await api('GET', `/portfolio/${portfolio.id}/${path}`, 404, undefined, second);
  });
  await check('BullMQ snapshot job completes and concurrent same-bucket retries do not duplicate', async () => {
    await Promise.all([completedJob('snapshot-portfolio', { portfolioId: portfolio.id }), completedJob('snapshot-portfolio', { portfolioId: portfolio.id })]);
    const rows = await portfolioDb.query('SELECT total_value_usd::text FROM portfolio_snapshots WHERE portfolio_id = $1', [portfolio.id]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].total_value_usd, '198.00');
  });
  await check('bounded history ranges and honest analytics/cost-basis limits', async () => {
    await portfolioDb.query("INSERT INTO portfolio_snapshots (portfolio_id,total_value_usd,recorded_at) VALUES ($1,'180',now()-interval '25 hours'),($1,'190',now()-interval '2 hours')", [portfolio.id]);
    await delay(1000);
    const day = await api('GET', `/portfolio/${portfolio.id}/history?range=24h&limit=10`, 200, undefined, first);
    assert.equal(day.points.length, 2);
    assert.equal(day.points.at(-1).valueUsd, '198');
    const week = await api('GET', `/portfolio/${portfolio.id}/history?range=7d&limit=2`, 200, undefined, first);
    assert.equal(week.points.length, 2);
    assert.equal(week.points[0].valueUsd, '180');
    assert.equal(week.points[1].valueUsd, '198');
    const analytics = await api('GET', `/portfolio/${portfolio.id}/analytics`, 200, undefined, first);
    assert.equal(analytics.totalValueUsd, '198');
    assert.equal(analytics.pnlAvailable, false);
    assert.equal(analytics.pnlReason, 'cost_basis_unavailable');
    assert.equal(analytics.allocation[0].percentage, '100');
    await api('GET', `/portfolio/${portfolio.id}/history?range=invalid`, 400, undefined, first);
  });
  await check('unknown nonzero holding remains unpriced and cannot produce a fake-zero snapshot', async () => {
    await portfolioDb.query("INSERT INTO holdings (portfolio_id,asset_key,asset_type,token_address,symbol,decimals,balance_raw) VALUES ($1,$2,'erc20',$3,'UNKNOWN',18,'1000000000000000000')", [portfolio.id, `erc20:${unknownToken}`, unknownToken]);
    const valued = await api('GET', `/portfolio/${portfolio.id}/valuation`, 200, undefined, first);
    assert.equal(valued.summary.totalValueUsd, null);
    assert.equal(valued.summary.pricedValueUsd, '198');
    assert.equal(valued.summary.complete, false);
    assert.equal(valued.holdings.find((item) => item.assetKey === `erc20:${unknownToken}`).valueUsd, null);
    await portfolioDb.query('DELETE FROM portfolio_snapshots WHERE portfolio_id = $1', [portfolio.id]);
    await completedJob('snapshot-portfolio', { portfolioId: portfolio.id });
    const snapshots = await portfolioDb.query('SELECT count(*)::int AS count FROM portfolio_snapshots WHERE portfolio_id = $1', [portfolio.id]);
    assert.equal(snapshots.rows[0].count, 0);
  });
  let watchlist;
  let watchlistItem;
  await check('watchlist create/list/detail/rename and normalized token/address items', async () => {
    watchlist = await api('POST', '/watchlists', 201, { name: ' Tokens ' }, first);
    assert.equal(watchlist.name, 'Tokens');
    watchlistItem = await api('POST', `/watchlists/${watchlist.id}/items`, 201, { itemType: 'token', address: tokenAddress.toUpperCase().replace('0X', '0x'), label: ' Test Token ' }, first);
    assert.equal(watchlistItem.address, tokenAddress);
    await api('POST', `/watchlists/${watchlist.id}/items`, 201, { itemType: 'address', address: activityWallet }, first);
    const detail = await api('GET', `/watchlists/${watchlist.id}`, 200, undefined, first);
    assert.equal(detail.items.length, 2);
    assert.equal((await api('GET', '/watchlists', 200, undefined, first)).total, 1);
    assert.equal((await api('PATCH', `/watchlists/${watchlist.id}`, 200, { name: 'Renamed' }, first)).name, 'Renamed');
  });
  await check('watchlist duplicate/concurrent insert protection and cross-owner denial', async () => {
    await api('POST', `/watchlists/${watchlist.id}/items`, 409, { itemType: 'token', address: tokenAddress }, first);
    const concurrentAddress = `0x${'e'.repeat(40)}`;
    const responses = await Promise.all([1, 2].map(() => fetch(`${apiUrl}/watchlists/${watchlist.id}/items`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${first.accessToken}` },
      body: JSON.stringify({ itemType: 'token', address: concurrentAddress }), signal: AbortSignal.timeout(15_000),
    })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    for (const response of responses) await response.body?.cancel();
    await api('GET', `/watchlists/${watchlist.id}`, 404, undefined, second);
    await api('PATCH', `/watchlists/${watchlist.id}`, 404, { name: 'Foreign' }, second);
    await api('DELETE', `/watchlists/${watchlist.id}`, 404, undefined, second);
    await api('POST', `/watchlists/${watchlist.id}/items`, 404, { itemType: 'address', address: activityWallet }, second);
    await api('DELETE', `/watchlists/${watchlist.id}/items/${watchlistItem.id}`, 404, undefined, second);
  });
  let crossing;
  let whale;
  let activity;
  await check('alert CRUD, rule validation and owner isolation', async () => {
    crossing = await api('POST', '/alerts', 201, { type: 'price_above', thresholdUsd: '100' }, first);
    whale = await api('POST', '/alerts', 201, { type: 'whale', thresholdUsd: '100000.000000000000000001' }, first);
    activity = await api('POST', '/alerts', 201, { type: 'wallet_activity', walletAddress: activityWallet }, first);
    assert.equal((await api('GET', '/alerts', 200, undefined, first)).total, 3);
    assert.equal((await api('GET', `/alerts/${crossing.id}`, 200, undefined, first)).thresholdUsd, '100');
    await api('POST', '/alerts', 400, { type: 'price_below', thresholdUsd: '0' }, first);
    await api('POST', '/alerts', 400, { type: 'wallet_activity' }, first);
    await api('GET', `/alerts/${crossing.id}`, 404, undefined, second);
    await api('PATCH', `/alerts/${crossing.id}`, 404, { enabled: false }, second);
    await api('DELETE', `/alerts/${crossing.id}`, 404, undefined, second);
  });
  await check('first fresh price observation persists baseline without an initial alert', async () => {
    await refreshPrice('native:eth');
    assert.equal(await eventCount(crossing.id), 0);
    const state = await portfolioDb.query('SELECT last_condition_met,last_evaluated_at FROM alerts WHERE id=$1', [crossing.id]);
    assert.equal(state.rows[0].last_condition_met, false);
    assert(state.rows[0].last_evaluated_at);
  });
  await check('price false-to-true crossing produces exactly one persisted event', async () => {
    fixtureEthPrice = '101';
    await refreshPrice('native:eth');
    assert.equal(await eventCount(crossing.id), 1);
  });
  await check('remaining above threshold suppresses duplicate alert events', async () => {
    fixtureEthPrice = '102';
    await refreshPrice('native:eth');
    assert.equal(await eventCount(crossing.id), 1);
  });
  await check('reset below threshold followed by recross emits a second event', async () => {
    fixtureEthPrice = '98'; await refreshPrice('native:eth');
    fixtureEthPrice = '101'; await refreshPrice('native:eth');
    assert.equal(await eventCount(crossing.id), 2);
  });
  await check('event listing and idempotent mark-read enforce ownership', async () => {
    const events = await api('GET', '/alerts/events', 200, undefined, first);
    const event = events.items.find((item) => item.alertId === crossing.id);
    assert(event);
    assert.equal((await api('GET', '/alerts/events', 200, undefined, second)).total, 0);
    await api('PATCH', `/alerts/events/${event.id}/read`, 404, undefined, second);
    const read = await api('PATCH', `/alerts/events/${event.id}/read`, 200, undefined, first);
    assert(read.readAt);
    assert.equal((await api('PATCH', `/alerts/events/${event.id}/read`, 200, undefined, first)).readAt, read.readAt);
  });
  let whaleTransfer;
  await check('real RabbitMQ transfer evaluates whale precision and independent wallet activity', async () => {
    const below = transfer('100000000000000000000000');
    await publish(below);
    await eventually('first wallet activity', async () => await eventCount(activity.id) === 1);
    assert.equal(await eventCount(whale.id), 0, 'Value below threshold was incorrectly rounded into a whale event');
    whaleTransfer = transfer('100000000000000000000001');
    await publish(whaleTransfer);
    await eventually('whale and wallet activity', async () => await eventCount(whale.id) === 1 && await eventCount(activity.id) === 2);
    const events = await portfolioDb.query('SELECT payload FROM alert_events WHERE alert_id = $1', [whale.id]);
    assert.equal(events.rows[0].payload.valueUsd, '100000.000000000000000001');
    assert.equal(events.rows[0].payload.amountFormatted, '100000.000000000000000001');
    assert.equal(events.rows[0].payload.valuationBasis, 'current_price');
    assert(events.rows[0].payload.priceFetchedAt);
  });
  await check('duplicate broker event and renamed source ID for the same log cannot duplicate events', async () => {
    await publish(whaleTransfer);
    const replay = { ...whaleTransfer, id: randomUUID() };
    await publish(replay);
    await eventually('reindexed source consumed', async () => {
      const result = await portfolioDb.query('SELECT 1 FROM processed_events WHERE event_id = $1', [replay.id]);
      return result.rows.length === 1;
    });
    await eventually('reindexed alert job completed', async () => {
      const jobs = await queue.getJobs(['completed'], 0, -1);
      return jobs.some((job) => job.name === 'evaluate-transfer-alerts' && job.data.event?.id === replay.id);
    });
    assert.equal(await eventCount(whale.id), 1);
    assert.equal(await eventCount(activity.id), 2);
  });
  await check('missing whale price still commits wallet activity, then a fresh price permits retry completion', async () => {
    const missing = transfer('2000000000000000000', unknownToken);
    await publish(missing);
    await eventually('unpriced wallet activity', async () => await eventCount(activity.id) === 3);
    assert.equal(await eventCount(whale.id), 1);
    const unavailable = await api('GET', `/prices/token/${unknownToken}`, 200);
    assert.equal(unavailable.priceUsd, null);
    assert.equal(unavailable.availability, 'unavailable');
    fixturePrices.set(unknownToken, '1');
    await refreshPrice(`erc20:${unknownToken}`);
    await eventually('unpriced transfer retry completion', async () => {
      const jobs = await queue.getJobs(['completed'], 0, -1);
      return jobs.some((job) => job.name === 'evaluate-transfer-alerts' && job.data.event?.id === missing.id);
    });
    assert.equal(await eventCount(activity.id), 3);
  });
  await check('remaining periodic job handlers complete in the isolated queue', async () => {
    await completedJob('refresh-asset-price', { assetKey: 'native:eth' });
    await completedJob('refresh-active-prices', { scope: 'active' });
    await completedJob('refresh-portfolio-valuations', { scope: 'active' });
  });
  await check('watchlist item/list and alert deletion remove only owner resources', async () => {
    await api('DELETE', `/watchlists/${watchlist.id}/items/${watchlistItem.id}`, 204, undefined, first);
    await api('DELETE', `/watchlists/${watchlist.id}`, 204, undefined, first);
    await api('GET', `/watchlists/${watchlist.id}`, 404, undefined, first);
    assert.equal((await api('PATCH', `/alerts/${whale.id}`, 200, { enabled: false }, first)).enabled, false);
    await api('DELETE', `/alerts/${crossing.id}`, 204, undefined, first);
    await api('GET', `/alerts/${crossing.id}`, 404, undefined, first);
  });
  if (process.argv.includes('--real-coingecko')) {
    await check('optional real CoinGecko ETH provider availability', async () => {
      const { ConfigService } = portfolioRequire('@nestjs/config');
      const { CoinGeckoClient } = await import(pathToFileURL(resolve(root, 'apps/portfolio-service/dist/modules/prices/coingecko.client.js')).href);
      const client = new CoinGeckoClient(new ConfigService({ ...sourceEnv, COINGECKO_MAX_RETRIES: '1', COINGECKO_TIMEOUT_MS: '10000' }));
      try {
        const real = await client.fetchPrice('native:eth');
        assert(real && typeof real.priceUsd === 'string' && /^\d+(?:\.\d+)?$/.test(real.priceUsd), 'Real CoinGecko price unavailable');
      } finally { client.onModuleDestroy(); }
    });
  }
  console.log(`Phase 8 isolated fixture integration: ${checks} checks passed.`);
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${redact(error instanceof Error ? error.message : error)}`);
  for (const service of children) console.error(`Captured ${service.name} output:\n${service.logs.split('\n').slice(-18).join('\n')}`);
} finally {
  let closed = false;
  try {
    await stopServices();
    closed = children.every((service) => service.exited);
    console.log('PASS own service processes shut down');
  } catch (error) {
    process.exitCode = 1;
    closed = children.every((service) => service.exited);
    console.error(`FAIL shutdown: ${redact(error instanceof Error ? error.message : error)}`);
  }
  if (queue) await queue.close().catch((error) => { process.exitCode = 1; console.error(`FAIL queue close: ${redact(error.message)}`); });
  if (publishChannel) await publishChannel.close().catch(() => undefined);
  if (closed) {
    for (const [label, action] of [['own Redis keys', cleanupRedis], ['own RabbitMQ queues/exchanges', cleanupBroker], ['marker-proven temporary databases', cleanupDatabases]]) {
      try { await action(); console.log(`PASS cleanup ${label}`); }
      catch (error) { process.exitCode = 1; console.error(`FAIL cleanup ${label}: ${redact(error instanceof Error ? error.message : error)}`); }
    }
  } else {
    process.exitCode = 1;
    console.error('FAIL resource cleanup skipped: an owned child is still running');
  }
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise((accept) => fixtureServer.close(accept));
  }
  if (redis?.isOpen) await redis.quit().catch(() => undefined);
  if (broker) await broker.close().catch(() => undefined);
  for (const database of databases) await database.admin.end().catch(() => undefined);
}
