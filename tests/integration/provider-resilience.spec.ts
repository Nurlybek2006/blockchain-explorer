import { describe, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { EthereumRpcClient } from '@blockchain-explorer/blockchain-client';
import { CoinGeckoClient } from '../../apps/portfolio-service/src/modules/prices/coingecko.client.js';
import { EtherscanClient } from '../../apps/indexer-service/src/modules/advanced/etherscan.client.js';
import { contract } from '../helpers/provider-fixtures.js';

async function provider(handler: (response: ServerResponse, count: number, body: string) => void) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    const buffers: Buffer[] = [];
    for await (const buffer of request) buffers.push(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    handler(response, ++requests, Buffer.concat(buffers).toString('utf8'));
  });
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  return { url: `http://127.0.0.1:${address.port}`, count: () => requests, stop: async () => {
    server.closeAllConnections(); await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  } };
}

describe('actual provider HTTP failure and cancellation boundaries', () => {
  it('Ethereum 429 Retry-After causes bounded backoff and eventual recovery', async () => {
    const fixture = await provider((response, count, raw) => {
      if (count < 3) { response.writeHead(429, { 'Retry-After': '0.1' }).end('{}'); return; }
      const body: unknown = JSON.parse(raw);
      const id = typeof body === 'object' && body !== null && 'id' in body ? body.id : 1;
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x65' }));
    });
    const client = new EthereumRpcClient({ url: fixture.url, timeoutMs: 500, maxRetries: 2, retryBaseDelayMs: 10, maxRetryDelayMs: 500, requestsPerSecond: 100 });
    const started = performance.now();
    try { expect(await client.getBlockNumber()).toBe(101n); expect(fixture.count()).toBe(3); expect(performance.now() - started).toBeGreaterThanOrEqual(180); }
    finally { client.close(); await fixture.stop(); }
  });
  it('Ethereum timeout retries only the configured attempts and never spins', async () => {
    const fixture = await provider(() => undefined);
    const client = new EthereumRpcClient({ url: fixture.url, timeoutMs: 100, maxRetries: 1, retryBaseDelayMs: 20, requestsPerSecond: 100 });
    const started = performance.now();
    try { await expect(client.getBlockNumber()).rejects.toThrow(); expect(fixture.count()).toBe(2); expect(performance.now() - started).toBeGreaterThanOrEqual(190); expect(performance.now() - started).toBeLessThan(2000); }
    finally { client.close(); await fixture.stop(); }
  });
  it('Ethereum unsupported debug method is a controlled non-retryable error', async () => {
    const fixture = await provider((response, _count, raw) => {
      const body: unknown = JSON.parse(raw); const id = typeof body === 'object' && body !== null && 'id' in body ? body.id : 1;
      response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }));
    });
    const client = new EthereumRpcClient({ url: fixture.url, maxRetries: 3, requestsPerSecond: 100 });
    try { await expect(client.traceTransaction(`0x${'1'.repeat(64)}`, { tracer: 'callTracer' })).rejects.toThrow(); expect(fixture.count()).toBe(1); }
    finally { client.close(); await fixture.stop(); }
  });
  it('Ethereum close aborts in-flight provider requests and closes queued work', async () => {
    const fixture = await provider(() => undefined);
    const client = new EthereumRpcClient({ url: fixture.url, timeoutMs: 10_000, maxRetries: 4, maxConcurrentRequests: 1, requestsPerSecond: 100 });
    const results = Promise.allSettled([client.getBlockNumber(), client.getBlockNumber(), client.getBlockNumber()]);
    await setTimeout(30); const started = performance.now(); client.close();
    try { expect((await results).every((result) => result.status === 'rejected')).toBe(true); expect(performance.now() - started).toBeLessThan(1000); expect(fixture.count()).toBeLessThanOrEqual(1); }
    finally { await fixture.stop(); }
  });
  it('CoinGecko timeout is bounded and shutdown aborts outstanding fetches', async () => {
    const fixture = await provider(() => undefined);
    const client = new CoinGeckoClient(new ConfigService({ COINGECKO_BASE_URL: fixture.url, COINGECKO_TIMEOUT_MS: 100, COINGECKO_MAX_RETRIES: 1,
      COINGECKO_RETRY_BASE_DELAY_MS: 10, COINGECKO_REQUESTS_PER_SECOND: 20 }));
    try { await expect(client.fetchPrice('native:eth')).rejects.toThrow(); expect(fixture.count()).toBe(2); }
    finally { client.onModuleDestroy(); await fixture.stop(); }
  });
  it('Etherscan unavailable has a sanitized bounded provider failure', async () => {
    const fixture = await provider((response) => response.writeHead(503).end('private upstream provider failure'));
    const client = new EtherscanClient(new ConfigService({ ETHERSCAN_BASE_URL: fixture.url, ETHERSCAN_API_KEY: 'fixture-key', ETHERSCAN_MAX_RETRIES: 0, ETHERSCAN_REQUESTS_PER_SECOND: 10 }));
    try { await expect(client.lookup(contract)).rejects.toThrow('Contract verification provider http'); expect(fixture.count()).toBe(1); }
    finally { client.onModuleDestroy(); await fixture.stop(); }
  });
  it('Etherscan missing key is unsupported without making network requests', async () => {
    const fixture = await provider((response) => response.writeHead(500).end());
    const client = new EtherscanClient(new ConfigService({ ETHERSCAN_BASE_URL: fixture.url, ETHERSCAN_API_KEY: '', ETHERSCAN_MAX_RETRIES: 0 }));
    try { expect((await client.lookup(contract)).status).toBe('unsupported'); expect(fixture.count()).toBe(0); }
    finally { client.onModuleDestroy(); await fixture.stop(); }
  });
});
