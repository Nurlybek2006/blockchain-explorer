import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// HTTP/build smoke: real isolated services, storage and broker; deterministic
// local provider fixtures. This does not claim browser interaction coverage.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'apps/web');
const apiRequire = createRequire(resolve(root, 'apps/api-gateway/package.json'));
const messagingRequire = createRequire(resolve(root, 'packages/messaging/package.json'));
const webRequire = createRequire(resolve(webRoot, 'package.json'));
const { parse } = apiRequire('dotenv');
const { Pool } = apiRequire('pg');
const { drizzle } = apiRequire('drizzle-orm/node-postgres');
const { migrate } = apiRequire('drizzle-orm/node-postgres/migrator');
const { createClient } = messagingRequire('redis');
const amqp = messagingRequire('amqplib');
const sourceEnv = { ...parse(await readFile(resolve(root, '.env'))), ...process.env };
const runId = randomBytes(12).toString('hex');
const marker = `phase9-verification:${runId}`;
const cachePrefix = `phase9:${runId}`;
const queueName = `phase9-${runId}-jobs`;
const exchangeName = `phase9.${runId}.events`;
const consumerQueue = `phase9.${runId}.portfolio`;
const apiUrl = 'http://127.0.0.1:3500';
const webUrl = 'http://127.0.0.1:3503';
const env = {
  ...sourceEnv, NODE_ENV: 'test', API_GATEWAY_PORT: '3500', INDEXER_PORT: '3501', PORTFOLIO_PORT: '3502',
  INDEXER_ENABLED: 'false', PRICE_SCHEDULER_ENABLED: 'false',
  INDEXER_INTERNAL_URL: 'http://127.0.0.1:3501', PORTFOLIO_INTERNAL_URL: 'http://127.0.0.1:3502',
  WEB_ORIGIN: webUrl, ETHEREUM_CHAIN_ID: '11155111',
  INTERNAL_SERVICE_TOKEN: randomBytes(40).toString('base64url'),
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'), JWT_REFRESH_SECRET: randomBytes(48).toString('base64url'),
  BCRYPT_ROUNDS: '10', CACHE_PREFIX: cachePrefix, PORTFOLIO_QUEUE_NAME: queueName,
  RABBITMQ_EXCHANGE: exchangeName, PORTFOLIO_EVENTS_QUEUE: consumerQueue,
  COINGECKO_API_KEY: '', COINGECKO_MAX_RETRIES: '0', COINGECKO_TIMEOUT_MS: '2000',
  COINGECKO_REQUESTS_PER_SECOND: '20', COINGECKO_MAX_CONCURRENT_REQUESTS: '2',
  PRICE_CACHE_TTL_SECONDS: '1', PRICE_UNAVAILABLE_CACHE_TTL_SECONDS: '1', PRICE_STALE_AFTER_SECONDS: '3600',
  PRICE_REFRESH_INTERVAL_MS: '86400000', PORTFOLIO_SNAPSHOT_INTERVAL_MS: '86400000',
  RPC_MAX_RETRIES: '0', RPC_TIMEOUT_MS: '2000', RPC_REQUESTS_PER_SECOND: '20',
};
// Deliberately do not pass backend .env credentials to the web build/server.
const webEnv = {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_API_URL: apiUrl, WEB_BUILD_DIR: '.next-phase9', WEB_TSCONFIG_PATH: '.next-phase9-tsconfig.json',
};
const tokenAddress = `0x${'a'.repeat(40)}`;
const wallet = `0x${randomBytes(20).toString('hex')}`;
const recipient = `0x${randomBytes(20).toString('hex')}`;
const transactionHash = `0x${randomBytes(32).toString('hex')}`;
const blockHash = `0x${randomBytes(32).toString('hex')}`;
const secrets = new Set(Object.entries({ ...sourceEnv, ...env })
  .filter(([key]) => /SECRET|PASSWORD|TOKEN|URL|API_KEY/.test(key))
  .map(([, value]) => value).filter((value) => typeof value === 'string' && value.length > 3));
const frontendPrivateValues = Object.entries({ ...sourceEnv, ...env })
  .filter(([key]) => /SECRET|PASSWORD|TOKEN|DATABASE_URL|REDIS_URL|RABBITMQ_URL|ETHEREUM_RPC_URL|API_KEY/.test(key))
  .map(([, value]) => value).filter((value) => typeof value === 'string' && value.length > 15);
const children = [];
const databases = [];
const generatedFiles = [];
const temporaryTsconfig = { path: resolve(webRoot, '.next-phase9-tsconfig.json'), created: false, generated: null };
let redis;
let broker;
let explorerDb;
let fixtureServer;
let ethPrice = '99';
let fixtureTimestamp = Math.floor(Date.now() / 1000);
let interrupted = false;
let checks = 0;
process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

function redact(input) {
  let text = String(input);
  for (const value of [...secrets].sort((left, right) => right.length - left.length)) text = text.split(value).join('[redacted]');
  return text.replace(/(?:postgres(?:ql)?|amqps?|rediss?|https?):\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/\$2[aby]\$\d\d\$[A-Za-z0-9./]+/g, '[redacted-password-hash]');
}

function running() {
  if (interrupted) throw new Error('Verification interrupted');
  for (const child of children) if (child.exited) throw new Error(`${child.name} exited unexpectedly`);
}

async function check(label, action) {
  running();
  await action();
  checks += 1;
  console.log(`PASS ${label}`);
}

function publicData(value) {
  if (value === null || typeof value !== 'object') return;
  assert(!Object.hasOwn(value, 'passwordHash') && !Object.hasOwn(value, 'password_hash'), 'Password hash exposed');
  for (const child of Object.values(value)) publicData(child);
}

function canonicalDecimal(value) {
  assert.equal(typeof value, 'string', 'Financial API values must remain decimal strings');
  assert(/^-?\d+(?:\.\d+)?$/.test(value), 'Invalid financial decimal string');
  const negative = value.startsWith('-');
  const [rawInteger, rawFraction = ''] = value.replace(/^-/, '').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  return `${negative && /[1-9]/.test(integer + fraction) ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function assertDecimal(actual, expected, message) {
  assert.equal(canonicalDecimal(actual), canonicalDecimal(expected), message);
}

async function request(base, method, path, expected, body, token, internal = false) {
  running();
  const response = await fetch(`${base}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: {
      accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(internal ? { 'x-internal-service-token': env.INTERNAL_SERVICE_TOKEN } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  if (text) {
    try { value = JSON.parse(text); } catch { throw new Error(`${method} ${path}: non-JSON response`); }
  }
  publicData(value);
  for (const key of ['accessToken', 'refreshToken']) if (typeof value?.[key] === 'string') secrets.add(value[key]);
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, received ${response.status}`);
  return value;
}
const api = (method, path, status, body, user) => request(apiUrl, method, path, status, body, user?.accessToken);
const internal = (method, path, status, body) => request(env.PORTFOLIO_INTERNAL_URL, method, path, status, body, undefined, true);

async function eventually(label, action, timeout = 30_000) {
  const deadline = Date.now() + timeout;
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
  assert(/^phase9_[a-f0-9]{24}_(identity|explorer|portfolio)$/.test(name), 'Refusing unrelated database operation');
  assert(name.startsWith(`phase9_${runId}_`), 'Refusing database operation for another run');
  return `"${name}"`;
}

async function createTestDatabase(app, role, key) {
  const name = `phase9_${runId}_${role}`;
  const identifier = databaseIdentifier(name);
  const admin = new Pool({ connectionString: databaseUrl(sourceEnv[key], 'postgres'), connectionTimeoutMillis: 5000 });
  const database = { name, admin, pool: null, created: false, marked: false };
  databases.push(database);
  await admin.query(`CREATE DATABASE ${identifier}`);
  database.created = true;
  await admin.query(`COMMENT ON DATABASE ${identifier} IS '${marker}'`);
  database.marked = true;
  env[key] = databaseUrl(sourceEnv[key], name);
  secrets.add(env[key]);
  database.pool = new Pool({ connectionString: env[key], connectionTimeoutMillis: 5000 });
  await migrate(drizzle(database.pool), { migrationsFolder: resolve(root, 'apps', app, 'src/database/migrations') });
  if (role === 'explorer') explorerDb = database.pool;
}

async function seedExplorer() {
  await explorerDb.query('INSERT INTO blocks (number, hash, parent_hash, miner, timestamp, gas_limit, gas_used, base_fee_per_gas, transaction_count) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,1)',
    ['10000', blockHash, `0x${'0'.repeat(64)}`, wallet, '30000000', '21000', '10000000000']);
  await explorerDb.query('INSERT INTO transactions (hash,block_number,block_hash,transaction_index,from_address,to_address,nonce,value,gas,gas_price,type,input) VALUES ($1,10000,$2,0,$3,$4,0,$5,21000,$6,2,$7)',
    [transactionHash, blockHash, wallet, recipient, '1000000000000000001', '20000000000', '0x']);
  await explorerDb.query('INSERT INTO receipts (transaction_hash,block_number,status,cumulative_gas_used,gas_used,effective_gas_price) VALUES ($1,10000,true,21000,21000,$2)',
    [transactionHash, '20000000000']);
  await explorerDb.query('INSERT INTO tokens (address,name,symbol,decimals,total_supply,first_seen_block,last_updated_block) VALUES ($1,$2,$3,18,$4,10000,10000)',
    [tokenAddress, 'Verification Token', 'FIX', '1000000000000000000000001']);
  await explorerDb.query('INSERT INTO token_transfers (transaction_hash,block_number,token_address,from_address,to_address,amount,transaction_index,log_index) VALUES ($1,10000,$2,$3,$4,$5,0,0)',
    [transactionHash, tokenAddress, wallet, recipient, '1000000000000000001']);
  await explorerDb.query('INSERT INTO addresses (address,is_contract,native_balance_wei,transaction_count,first_seen_block,last_seen_block) VALUES ($1,false,$2,1,10000,10000),($3,false,0,1,10000,10000)',
    [wallet, '2000000000000000000', recipient]);
}

async function startFixtures() {
  fixtureServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/rpc') {
        let text = '';
        for await (const chunk of req) {
          text += chunk.toString();
          if (text.length > 1_048_576) throw new Error('Fixture request too large');
        }
        const input = JSON.parse(text);
        let result;
        if (input.method === 'eth_chainId') result = '0xaa36a7';
        else if (input.method === 'eth_blockNumber') result = '0x2710';
        else if (input.method === 'eth_getBalance') result = '0x1bc16d674ec80000';
        else if (input.method === 'eth_call' && input.params?.[0]?.data?.startsWith('0x313ce567')) result = `0x${'12'.padStart(64, '0')}`;
        else if (input.method === 'eth_call' && input.params?.[0]?.data?.startsWith('0x70a08231')) result = `0x${'0'.repeat(64)}`;
        res.end(JSON.stringify(result === undefined
          ? { jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'Unsupported fixture RPC method' } }
          : { jsonrpc: '2.0', id: input.id, result }));
        return;
      }
      const eth = url.pathname === '/api/v3/simple/price';
      const token = url.pathname === '/api/v3/simple/token_price/ethereum';
      if (!eth && !token) { res.statusCode = 404; res.end('{}'); return; }
      const key = eth ? 'ethereum' : url.searchParams.get('contract_addresses')?.toLowerCase();
      if (!eth && key !== tokenAddress) { res.end('{}'); return; }
      fixtureTimestamp = Math.max(fixtureTimestamp + 1, Math.floor(Date.now() / 1000));
      res.end(`{${JSON.stringify(key)}:{"usd":${eth ? ethPrice : '1'},"usd_24h_change":1.25,"usd_market_cap":1234567890.01,"last_updated_at":${fixtureTimestamp}}}`);
    } catch { res.statusCode = 500; res.end('{"error":"Fixture request failed"}'); }
  });
  await new Promise((accept, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', accept); });
  const address = fixtureServer.address();
  assert(address && typeof address === 'object');
  env.ETHEREUM_RPC_URL = `http://127.0.0.1:${address.port}/rpc`;
  env.COINGECKO_BASE_URL = `http://127.0.0.1:${address.port}/api/v3`;
}

function launch(name, args, cwd, launchEnv) {
  const child = spawn(process.execPath, args, { cwd, env: launchEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const service = { name, child, exited: false, logs: '' };
  const capture = (chunk) => { service.logs = `${service.logs}${redact(chunk.toString())}`.slice(-24_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => { capture(error.message); service.exited = true; });
  child.once('close', () => { service.exited = true; });
  children.push(service);
  return service;
}

function startService(name) {
  const entry = pathToFileURL(resolve(root, 'apps', name, 'dist/main.js')).href;
  const wrapper = `process.on('message', message => {
    if (message && message.type === 'phase9-verification-stop') process.emit('SIGTERM', 'SIGTERM');
  }); await import(${JSON.stringify(entry)});`;
  launch(name, ['--input-type=module', '--eval', wrapper], resolve(root, 'apps', name), env);
}

async function ready(name, base) {
  await eventually(`${name} readiness`, async () => {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) return false;
      const value = await response.json();
      assert.equal(value.service, name);
      assert.equal(value.database, 'connected');
      if (name !== 'indexer-service') assert.equal(value.redis, 'connected');
      if (name === 'portfolio-service') assert.equal(value.rabbitmq, 'connected');
      return true;
    } catch (error) { if (error instanceof assert.AssertionError) throw error; return false; }
  }, 45_000);
}

async function buildWeb() {
  for (const filename of ['next-env.d.ts']) {
    const path = resolve(webRoot, filename);
    const before = await readFile(path, 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    generatedFiles.push({ path, filename, before, after: null });
  }
  const config = JSON.parse(await readFile(resolve(webRoot, 'tsconfig.json'), 'utf8'));
  config.compilerOptions = { ...config.compilerOptions, tsBuildInfoFile: '.next-phase9/cache/phase9.tsbuildinfo' };
  config.include = config.include.filter((value) => !value.startsWith('.next/'));
  config.exclude = [...new Set([...config.exclude.filter((value) => value !== '.next-phase9'), '.next'])];
  // Exclusive creation proves this invocation owns the temporary config. Never
  // overwrite or delete an existing file from another run or from an editor.
  const initialConfig = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(temporaryTsconfig.path, initialConfig, { flag: 'wx' });
  temporaryTsconfig.created = true;
  temporaryTsconfig.generated = initialConfig;
  const child = spawn(process.execPath, [webRequire.resolve('next/dist/bin/next'), 'build'], {
    cwd: webRoot, env: webEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => { output = `${output}${redact(chunk.toString())}`.slice(-32_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  temporaryTsconfig.generated = await readFile(temporaryTsconfig.path, 'utf8');
  for (const file of generatedFiles) file.after = await readFile(file.path, 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (code !== 0) { console.error(output); throw new Error(`Isolated web production build exited ${code}`); }
  await access(resolve(webRoot, '.next-phase9/BUILD_ID'));
  console.log(output.trim());
}

function startWeb() {
  const entry = pathToFileURL(webRequire.resolve('next/dist/bin/next')).href;
  const wrapper = `process.on('message', message => {
    if (message && message.type === 'phase9-verification-stop') process.emit('SIGTERM', 'SIGTERM');
  }); process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(entry))}, 'start', '--port', '3503', '--hostname', '127.0.0.1'];
  await import(${JSON.stringify(entry)});`;
  launch('web', ['--input-type=module', '--eval', wrapper], webRoot, webEnv);
}

async function page(path, expected = 200) {
  const response = await fetch(`${webUrl}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, expected, `Web ${path}: unexpected HTTP status`);
  const html = await response.text();
  assert(response.headers.get('content-type')?.includes('text/html'), `Web ${path}: missing HTML content type`);
  assert(html.includes('Blockchain Explorer'), `Web ${path}: missing project identity`);
  assert(!html.includes('Welcome to Next.js') && !html.includes('Get started by editing'), 'Starter UI remains');
  for (const value of frontendPrivateValues) assert(!html.includes(value), 'Private environment value exposed in rendered HTML');
  return html;
}

async function checkBrowserBundle() {
  const stack = [resolve(webRoot, '.next-phase9/static')];
  let files = 0;
  let configuredApiFound = false;
  while (stack.length) {
    const directory = stack.pop();
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) stack.push(path);
      else if (item.isFile() && item.name.endsWith('.js')) {
        files += 1;
        const source = await readFile(path, 'utf8');
        if (source.includes(apiUrl)) configuredApiFound = true;
        for (const value of frontendPrivateValues) assert(!source.includes(value), 'Private environment value exposed in browser JavaScript');
      }
    }
  }
  assert(files > 0, 'No browser JavaScript chunks built');
  assert(configuredApiFound, 'Browser API URL was not frozen to the isolated Gateway during build');
}

async function register(label) {
  const email = `phase9-${label}-${runId}@example.com`;
  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  secrets.add(password);
  const result = await api('POST', '/auth/register', 201, { email, password, displayName: 'Frontend Verification' });
  assert.equal(result.user.email, email);
  assert.equal(typeof result.user.id, 'string');
  return { ...result, email, password };
}

async function stopChildren() {
  const results = await Promise.allSettled(children.map(async (service) => {
    if (service.exited) return;
    const closed = new Promise((accept) => service.child.once('close', accept));
    if (service.child.connected) service.child.send({ type: 'phase9-verification-stop' }, () => undefined);
    else service.child.kill('SIGTERM');
    const graceful = await Promise.race([closed.then(() => true), delay(45_000, undefined, { ref: false }).then(() => false)]);
    if (!graceful) {
      service.child.kill('SIGKILL');
      await Promise.race([closed, delay(5000, undefined, { ref: false })]);
      throw new Error(`${service.name} required forced shutdown`);
    }
  }));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

async function cleanupRedis() {
  if (!redis?.isOpen) return;
  for (const prefix of [`${cachePrefix}:`, `bull:${queueName}:`]) {
    assert(prefix.includes(runId), 'Refusing unrelated Redis namespace');
    for await (const result of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      const keys = Array.isArray(result) ? result : [result];
      assert(keys.every((key) => typeof key === 'string' && key.startsWith(prefix)), 'Refusing unrelated Redis key');
      if (keys.length) await redis.del(keys);
    }
  }
}

async function cleanupBroker() {
  if (!broker) return;
  for (const [kind, name] of [['queue', consumerQueue], ['queue', `${consumerQueue}.dlq`], ['exchange', exchangeName], ['exchange', `${exchangeName}.dlx`]]) {
    assert(name.startsWith(`phase9.${runId}.`), 'Refusing unrelated broker topology');
    const channel = await broker.createChannel();
    channel.on('error', () => undefined);
    try { if (kind === 'queue') await channel.deleteQueue(name); else await channel.deleteExchange(name); }
    catch (error) { if (error.code !== 404) throw error; }
    finally { await channel.close().catch(() => undefined); }
  }
}

async function cleanupDatabases() {
  for (const database of databases) if (database.pool) await database.pool.end();
  for (const database of databases) {
    if (!database.created) continue;
    const proof = await database.admin.query("SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = $1", [database.name]);
    assert(database.marked && proof.rows.length === 1 && proof.rows[0].marker === marker, 'Refusing database drop without this run ownership marker');
    await database.admin.query(`DROP DATABASE ${databaseIdentifier(database.name)}`);
    database.created = false;
  }
}

async function restoreGeneratedConfig() {
  for (const file of generatedFiles) {
    if (file.before === null || file.before === file.after) continue;
    const current = await readFile(file.path, 'utf8');
    assert.equal(current, file.after, `Generated ${file.filename} changed outside the verifier; leaving it untouched`);
    // Next owns this ignored declaration file; restore its previous distDir imports.
    assert(/^\/\/\/ <reference types="next" \/>/.test(file.after), 'Unexpected Next declaration file; leaving it untouched');
    await writeFile(file.path, file.before);
  }
  if (temporaryTsconfig.created) {
    assert(temporaryTsconfig.generated !== null, 'Temporary config final content unknown; leaving it untouched');
    assert.equal(await readFile(temporaryTsconfig.path, 'utf8'), temporaryTsconfig.generated, 'Temporary config changed outside the verifier; leaving it untouched');
    await unlink(temporaryTsconfig.path);
    temporaryTsconfig.created = false;
  }
}

async function browserReviewWindow() {
  console.log('Browser review ready: http://127.0.0.1:3503');
  console.log('The isolated production web and services remain available for manual review.');
  console.log('Send a newline to finish review and clean up; this window closes after 10 minutes.');
  const input = createInterface({ input: process.stdin, terminal: false });
  await new Promise((accept) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.removeListener('SIGINT', finish);
      process.removeListener('SIGTERM', finish);
      input.close();
      accept();
    };
    const timer = setTimeout(finish, 10 * 60_000);
    input.once('line', finish);
    input.once('close', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
  running();
  console.log('Manual browser review window closed; cleaning up owned resources.');
}

try {
  console.log('Phase 9 production build and HTTP/API smoke; no browser interaction automation.');
  console.log('Real isolated PostgreSQL/Redis/RabbitMQ/services; deterministic local Ethereum RPC/CoinGecko fixtures.');
  for (const key of ['IDENTITY_DATABASE_URL', 'EXPLORER_DATABASE_URL', 'PORTFOLIO_DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL']) assert(sourceEnv[key], `Missing infrastructure setting ${key}`);
  await Promise.all([...[3500, 3501, 3502, 3503].map(freePort),
    ...['api-gateway', 'indexer-service', 'portfolio-service'].map((name) => access(resolve(root, 'apps', name, 'dist/main.js')))]);
  await check('three isolated temporary databases migrated', async () => {
    await createTestDatabase('api-gateway', 'identity', 'IDENTITY_DATABASE_URL');
    await createTestDatabase('indexer-service', 'explorer', 'EXPLORER_DATABASE_URL');
    await createTestDatabase('portfolio-service', 'portfolio', 'PORTFOLIO_DATABASE_URL');
    await seedExplorer();
  });
  await check('isolated Redis/broker connected and local providers ready', async () => {
    redis = createClient({ url: env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    redis.on('error', () => undefined);
    await redis.connect();
    assert.equal(await redis.ping(), 'PONG');
    broker = await amqp.connect(env.RABBITMQ_URL, { timeout: 5000 });
    broker.on('error', () => undefined);
    await startFixtures();
  });
  for (const name of ['indexer-service', 'portfolio-service', 'api-gateway']) startService(name);
  await check('three real built services healthy', async () => {
    await Promise.all([ready('api-gateway', apiUrl), ready('indexer-service', env.INDEXER_INTERNAL_URL), ready('portfolio-service', env.PORTFOLIO_INTERNAL_URL)]);
  });
  await check('web production build uses separate output and isolated public API URL', buildWeb);
  await check('browser chunks contain configured API URL and no backend secrets', checkBrowserBundle);
  startWeb();
  await eventually('web readiness', async () => {
    try { return (await fetch(webUrl, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
  }, 45_000);
  await check('public App Router pages serve production HTML', async () => {
    for (const path of ['/', '/blocks', '/blocks/10000', `/tx/${transactionHash}`, `/address/${wallet}`, '/tokens', `/token/${tokenAddress}`, `/search?q=${wallet}`, '/login', '/register']) await page(path);
  });
  await check('protected page shells and missing-route response are served', async () => {
    for (const path of ['/portfolio', '/watchlists', '/alerts', '/settings']) await page(path);
    await page('/phase9-unknown-route', 404);
  });
  await check('Gateway CORS permits the verification web origin', async () => {
    const response = await fetch(`${apiUrl}/auth/login`, { method: 'OPTIONS', headers: { origin: webUrl, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), webUrl);
  });
  await check('public explorer stats, blocks and precision values', async () => {
    const stats = await api('GET', '/stats', 200);
    assert.equal(stats.blocks, 1);
    assert.equal(stats.latestBlock.number, '10000');
    const blocks = await api('GET', '/blocks?page=1&limit=10', 200);
    assert.equal(blocks.pagination.total, 1);
    assert.equal(blocks.data[0].number, '10000');
    const block = await api('GET', '/blocks/10000', 200);
    assert.equal(block.transactions[0].value, '1000000000000000001');
  });
  await check('public transaction, address and token details use actual contracts', async () => {
    const transaction = await api('GET', `/tx/${transactionHash}`, 200);
    assert.equal(transaction.receipt.status, true);
    assert.equal(transaction.tokenTransfers[0].amount, '1000000000000000001');
    const address = await api('GET', `/address/${wallet}`, 200);
    assert.equal(address.address.nativeBalanceWei, '2000000000000000000');
    assert.equal(address.pagination.total, 1);
    const tokens = await api('GET', '/tokens', 200);
    assert.equal(tokens.data[0].symbol, 'FIX');
    const token = await api('GET', `/token/${tokenAddress}`, 200);
    assert.equal(token.token.totalSupply, '1000000000000000000000001');
    assert.equal(token.transfers[0].transactionHash, transactionHash);
  });
  let owner;
  let other;
  await check('register, login and authenticated me through real storage', async () => {
    owner = await register('owner');
    other = await register('other');
    const login = await api('POST', '/auth/login', 200, { email: owner.email, password: owner.password });
    owner = { ...owner, ...login };
    assert.equal((await api('GET', '/users/me', 200, undefined, owner)).id, owner.user.id);
    await api('GET', '/users/me', 401);
    await api('GET', '/portfolio', 401);
    await api('GET', '/watchlists', 401);
    await api('GET', '/alerts', 401);
  });
  await check('refresh rotation returns valid new authentication', async () => {
    const refreshed = await api('POST', '/auth/refresh', 200, { refreshToken: owner.refreshToken });
    assert.notEqual(refreshed.refreshToken, owner.refreshToken);
    owner = { ...owner, ...refreshed };
    assert.equal((await api('GET', '/users/me', 200, undefined, owner)).id, owner.user.id);
  });
  let portfolio;
  await check('portfolio create/list/detail and worker initial holding sync', async () => {
    portfolio = await api('POST', '/portfolio', 201, { name: 'Frontend portfolio', walletAddress: wallet }, owner);
    assert.equal((await api('GET', '/portfolio', 200, undefined, owner)).items[0].id, portfolio.id);
    const detail = await api('GET', `/portfolio/${portfolio.id}`, 200, undefined, owner);
    assert.equal(detail.walletAddress, wallet);
    await eventually('initial ETH holding', async () => {
      const holdings = await api('GET', `/portfolio/${portfolio.id}/holdings`, 200, undefined, owner);
      const native = holdings.find((holding) => holding.assetKey === 'native:eth');
      if (!native) return false;
      assert.equal(native.balanceRaw, '2000000000000000000');
      assert.equal(native.balanceFormatted, '2');
      return true;
    });
    await api('GET', `/portfolio/${portfolio.id}`, 404, undefined, other);
    await page(`/portfolio/${portfolio.id}`);
  });
  await check('price, valuation, analytics and history preserve financial semantics', async () => {
    await internal('POST', '/internal/prices/refresh', 201, { assetKey: 'native:eth' });
    const price = await api('GET', '/prices/eth', 200);
    assertDecimal(price.priceUsd, '99');
    const valuation = await api('GET', `/portfolio/${portfolio.id}/valuation`, 200, undefined, owner);
    assertDecimal(valuation.summary.totalValueUsd, '198');
    const analytics = await api('GET', `/portfolio/${portfolio.id}/analytics`, 200, undefined, owner);
    assertDecimal(analytics.totalValueUsd, '198');
    assert.equal(analytics.pnlAvailable, false);
    assert.equal(analytics.pnlReason, 'cost_basis_unavailable');
    const history = await api('GET', `/portfolio/${portfolio.id}/history?range=7d&limit=100`, 200, undefined, owner);
    assert.equal(history.range, '7d');
    assert(Array.isArray(history.points));
    for (const point of history.points) assert.equal(typeof point.valueUsd, 'string');
    await api('GET', `/portfolio/${portfolio.id}/analytics`, 404, undefined, other);
  });
  let watchlist;
  let watchlistItem;
  await check('watchlist create/rename/item/detail/list with ownership', async () => {
    watchlist = await api('POST', '/watchlists', 201, { name: 'Frontend watchlist' }, owner);
    assert.equal((await api('PATCH', `/watchlists/${watchlist.id}`, 200, { name: 'Renamed watchlist' }, owner)).name, 'Renamed watchlist');
    watchlistItem = await api('POST', `/watchlists/${watchlist.id}/items`, 201, { itemType: 'token', address: tokenAddress, label: 'Verification token' }, owner);
    assert.equal((await api('GET', `/watchlists/${watchlist.id}`, 200, undefined, owner)).items[0].id, watchlistItem.id);
    assert.equal((await api('GET', '/watchlists', 200, undefined, owner)).total, 1);
    await api('GET', `/watchlists/${watchlist.id}`, 404, undefined, other);
    await page(`/watchlists/${watchlist.id}`);
  });
  let alert;
  await check('alert create/update/list and real crossing event', async () => {
    alert = await api('POST', '/alerts', 201, { type: 'price_above', thresholdUsd: '100' }, owner);
    assertDecimal((await api('GET', '/alerts', 200, undefined, owner)).items[0].thresholdUsd, '100');
    await internal('POST', '/internal/prices/refresh', 201, { assetKey: 'native:eth' });
    ethPrice = '101';
    await internal('POST', '/internal/prices/refresh', 201, { assetKey: 'native:eth' });
    const events = await eventually('crossing alert event', async () => {
      const result = await api('GET', '/alerts/events', 200, undefined, owner);
      return result.items.length ? result : false;
    });
    const event = events.items[0];
    assert.equal(event.alertId, alert.id);
    assert.equal(event.readAt, null);
    await api('PATCH', `/alerts/events/${event.id}/read`, 404, undefined, other);
    assert((await api('PATCH', `/alerts/events/${event.id}/read`, 200, undefined, owner)).readAt);
    assert.equal((await api('PATCH', `/alerts/${alert.id}`, 200, { enabled: false }, owner)).enabled, false);
  });
  await check('destructive resource actions affect only the owner', async () => {
    await api('DELETE', `/watchlists/${watchlist.id}/items/${watchlistItem.id}`, 204, undefined, owner);
    await api('DELETE', `/watchlists/${watchlist.id}`, 204, undefined, owner);
    await api('DELETE', `/alerts/${alert.id}`, 204, undefined, owner);
    await api('DELETE', `/portfolio/${portfolio.id}`, 204, undefined, owner);
    await api('GET', `/portfolio/${portfolio.id}`, 404, undefined, owner);
    await api('POST', '/auth/logout-all', 204, undefined, owner);
    await api('POST', '/auth/refresh', 401, { refreshToken: owner.refreshToken });
  });
  console.log(`Phase 9 production build and HTTP/API smoke: ${checks} checks passed.`);
  if (process.argv.includes('--browser-review')) await browserReviewWindow();
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL ${redact(error instanceof Error ? error.message : error)}`);
  for (const service of children) console.error(`Captured ${service.name} output:\n${service.logs.split('\n').slice(-18).join('\n')}`);
} finally {
  let closed = false;
  try { await stopChildren(); closed = children.every((child) => child.exited); console.log('PASS own services and Next server shut down'); }
  catch (error) { process.exitCode = 1; closed = children.every((child) => child.exited); console.error(`FAIL shutdown: ${redact(error.message)}`); }
  if (closed) {
    for (const [label, action] of [['own Redis keys', cleanupRedis], ['own RabbitMQ topology', cleanupBroker], ['marker-proven temporary databases', cleanupDatabases], ['generated Next configuration restored', restoreGeneratedConfig]]) {
      try { await action(); console.log(`PASS cleanup ${label}`); }
      catch (error) { process.exitCode = 1; console.error(`FAIL cleanup ${label}: ${redact(error.message)}`); }
    }
  } else { process.exitCode = 1; console.error('FAIL resource cleanup skipped because an owned child is still running'); }
  if (fixtureServer) { fixtureServer.closeAllConnections(); await new Promise((accept) => fixtureServer.close(accept)); }
  if (redis?.isOpen) await redis.quit().catch(() => undefined);
  if (broker) await broker.close().catch(() => undefined);
  for (const database of databases) await database.admin.end().catch(() => undefined);
}
