import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { root, type TestEnvironment } from './test-environment.js';
import { eventually, record } from './assertions.js';
import { contract, token, startProviderFixture, type ProviderFixture } from './provider-fixtures.js';

export interface ApplicationStack {
  urls: { api: string; indexer: string; portfolio: string };
  env: NodeJS.ProcessEnv;
  children: Map<string, ChildProcess>;
  output: Map<string, string>;
  fixture: ProviderFixture;
  launch: (name: string, overrides?: NodeJS.ProcessEnv, readinessStatus?: number) => Promise<ChildProcess>;
  stop: () => Promise<void>;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TCP port unavailable');
  await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  return address.port;
}

export async function stopApplication(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((accept) => child.once('exit', () => accept()));
  if (child.connected) child.send({ type: 'test-stop' });
  else child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Application graceful shutdown timed out')), 15_000); })]); }
  catch (error) { child.kill('SIGKILL'); await exited; throw error; }
  finally { if (timer) clearTimeout(timer); }
  if (child.exitCode !== 0) throw new Error(`Application exited without successful shutdown (${child.exitCode ?? child.signalCode})`);
}

export interface BlockProcessingMeasurements { durationMs: number; rpcWaitMs: number; persistMs: number; transactionCount: number; }
export async function processBlock(child: ChildProcess, block: unknown, confirmedHead = '101'): Promise<BlockProcessingMeasurements> {
  return new Promise<BlockProcessingMeasurements>((accept, reject) => {
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error('Block processor deadline exceeded')); }, 20_000);
    const receive = (message: unknown) => {
      const result = record(message); if (result.type !== 'test-block-result') return;
      clearTimeout(timer); child.off('message', receive);
      if (result.success !== true) { reject(new Error(typeof result.message === 'string' ? result.message : 'Block processing failed')); return; }
      const measurement = record(result.measurement);
      if (typeof measurement.durationMs !== 'number' || typeof measurement.rpcWaitMs !== 'number' || typeof measurement.persistMs !== 'number' || typeof measurement.transactionCount !== 'number') {
        reject(new Error('Invalid block processing measurements')); return;
      }
      accept({ durationMs: measurement.durationMs, rpcWaitMs: measurement.rpcWaitMs, persistMs: measurement.persistMs, transactionCount: measurement.transactionCount });
    };
    child.on('message', receive); child.send({ type: 'test-process-block', block, confirmedHead });
  });
}

export async function startApplicationStack(environment: TestEnvironment): Promise<ApplicationStack> {
  const fixture = await startProviderFixture();
  const ports = { api: await freePort(), indexer: await freePort(), portfolio: await freePort() };
  const urls = { api: `http://127.0.0.1:${ports.api}`, indexer: `http://127.0.0.1:${ports.indexer}`, portfolio: `http://127.0.0.1:${ports.portfolio}` };
  const output = new Map<string, string>(); const children = new Map<string, ChildProcess>();
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', LOG_FORMAT: 'json', OTEL_ENABLED: 'false', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    API_GATEWAY_PORT: String(ports.api), INDEXER_PORT: String(ports.indexer), PORTFOLIO_PORT: String(ports.portfolio),
    IDENTITY_DATABASE_URL: environment.databaseUrls.identity, EXPLORER_DATABASE_URL: environment.databaseUrls.explorer,
    PORTFOLIO_DATABASE_URL: environment.databaseUrls.portfolio, REDIS_URL: environment.redisUrl, RABBITMQ_URL: environment.rabbitUrl,
    INDEXER_INTERNAL_URL: urls.indexer, PORTFOLIO_INTERNAL_URL: urls.portfolio, WEB_ORIGIN: 'http://localhost:3003',
    JWT_ACCESS_SECRET: randomBytes(40).toString('hex'), JWT_REFRESH_SECRET: randomBytes(40).toString('hex'),
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '30d', BCRYPT_ROUNDS: '10', INTERNAL_SERVICE_TOKEN: randomBytes(40).toString('hex'),
    CACHE_PREFIX: `tc:${environment.runId}:gateway`, PORTFOLIO_QUEUE_NAME: `tc-${environment.runId}-portfolio`,
    RABBITMQ_EXCHANGE: `tc.${environment.runId}.system`, PORTFOLIO_EVENTS_QUEUE: `tc.${environment.runId}.portfolio.events`, REALTIME_EVENTS_QUEUE: `tc.${environment.runId}.realtime`,
    ETHEREUM_CHAIN_ID: '11155111', ETHEREUM_RPC_URL: fixture.url, INDEXER_ENABLED: 'false', RPC_MAX_RETRIES: '0', RPC_TIMEOUT_MS: '2000', RPC_REQUESTS_PER_SECOND: '50',
    PRICE_SCHEDULER_ENABLED: 'false', COINGECKO_BASE_URL: fixture.url, COINGECKO_API_KEY: '', COINGECKO_MAX_RETRIES: '0', COINGECKO_TIMEOUT_MS: '2000',
    COINGECKO_REQUESTS_PER_SECOND: '20', COINGECKO_MAX_CONCURRENT_REQUESTS: '2', PRICE_CACHE_TTL_SECONDS: '1', PRICE_UNAVAILABLE_CACHE_TTL_SECONDS: '1',
    PRICE_STALE_AFTER_SECONDS: '3600', PRICE_REFRESH_INTERVAL_MS: '86400000', PORTFOLIO_SNAPSHOT_INTERVAL_MS: '86400000',
    EXPLORER_ENRICHMENT_ENABLED: 'true', CONTRACT_VERIFICATION_ENABLED: 'true', ETHERSCAN_BASE_URL: `${fixture.url}/v2/api`, ETHERSCAN_API_KEY: 'fixture-key',
    ETHERSCAN_CHAIN_ID: '11155111', ETHERSCAN_MAX_RETRIES: '0', ETHERSCAN_REQUESTS_PER_SECOND: '10', TRACE_ENABLED: 'true', TRACE_MAX_RETRIES: '1', TRACE_TIMEOUT_MS: '3000',
    EXPLORER_JOBS_QUEUE_PREFIX: `tc-${environment.runId}-explorer`, NETWORK_STATUS_INTERVAL_MS: '1000', REALTIME_ENABLED: 'true',
    OUTBOX_POLL_INTERVAL_MS: '100', OUTBOX_MAX_RETRY_DELAY_MS: '200', DB_CONNECTION_TIMEOUT_MS: '500',
    API_RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_AUTH_MAX: '1000', RATE_LIMIT_SEARCH_MAX: '2000', RATE_LIMIT_EXPENSIVE_MAX: '2000',
  };
  const secrets = Object.entries(env).filter(([key, value]) => /SECRET|PASSWORD|TOKEN|URL|API_KEY/.test(key) && value && value.length > 8).map(([, value]) => value).filter((value): value is string => value !== undefined);
  const redact = (value: string) => { let result = value; for (const secret of secrets) result = result.split(secret).join('[redacted]'); return result; };
  const launch = async (name: string, overrides: NodeJS.ProcessEnv = {}, readinessStatus = 200) => {
    const entrypoint = resolve(root, 'apps', name, 'dist/main.js');
    const helper = resolve(root, 'tests/helpers', name === 'indexer-service' ? 'indexer-process.mjs' : 'application-process.mjs');
    const child = spawn(process.execPath, [helper, entrypoint], { cwd: resolve(root, 'apps', name), env: { ...env, ...overrides }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const key = children.has(name) ? `${name}-${children.size}` : name;
    children.set(key, child); output.set(key, '');
    child.on('error', (error) => output.set(key, `${output.get(key) ?? ''}\n${redact(error.message)}`));
    child.on('message', (message: unknown) => {
      const value = record(message);
      if (value.type === 'test-startup-stage' && typeof value.stage === 'string') output.set(key, `${output.get(key) ?? ''}\nStartup stage: ${value.stage}`);
    });
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (data: Buffer) => output.set(key, ((output.get(key) ?? '') + redact(data.toString('utf8'))).slice(-24_000)));
    const portKey = name === 'api-gateway' ? 'API_GATEWAY_PORT' : name === 'indexer-service' ? 'INDEXER_PORT' : 'PORTFOLIO_PORT';
    const url = `http://127.0.0.1:${overrides[portKey] ?? env[portKey]}`;
    try {
      await eventually(async () => {
        if (child.exitCode !== null) throw new Error(`${name} startup failed: ${output.get(key)}`);
        try { return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })).status === readinessStatus; } catch { return false; }
      }, (ready) => ready, 60_000);
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = new Promise<void>((accept) => child.once('exit', () => accept()));
        child.kill('SIGKILL'); await exit;
      }
      children.delete(key);
      throw new Error(`${name} startup failed: ${error instanceof Error ? error.message : 'Unknown failure'}\n${output.get(key)}`);
    }
    return child;
  };
  const stop = async () => {
    const results = await Promise.allSettled([...children.values()].map(stopApplication));
    await fixture.stop();
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  };
  const pool = new Pool({ connectionString: environment.databaseUrls.explorer });
  try {
    await pool.query("INSERT INTO tokens (address,name,symbol,decimals) VALUES ($1,'Test Token','TC',18) ON CONFLICT DO NOTHING", [token]);
    await pool.query('INSERT INTO addresses (address,is_contract,first_seen_block,last_seen_block,code_checked_block) VALUES ($1,true,100,100,100) ON CONFLICT DO NOTHING', [contract]);
    await launch('indexer-service'); await launch('portfolio-service'); await launch('api-gateway');
    return { urls, env, children, output, fixture, launch, stop };
  } catch (error) { await stop().catch(() => undefined); throw error; }
  finally { await pool.end(); }
}
