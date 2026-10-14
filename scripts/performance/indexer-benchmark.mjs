import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { startTestEnvironment } from '../../tests/dist/helpers/test-environment.js';
import { startApplicationStack, processBlock } from '../../tests/dist/helpers/application-stack.js';
import { fixtureBlock } from '../../tests/dist/helpers/provider-fixtures.js';
import { boundedInteger, distribution, saveReport } from './report.mjs';
import { benchmarkHttp } from './http-benchmark.mjs';
import { auditDatabase } from './database-audit.mjs';
const require = createRequire(new URL('../../tests/package.json', import.meta.url));
const { Pool } = require('pg');
const { WebSocket } = require('ws');

async function measureWebSocket(url, child, clientCount) {
  const clients = []; const counts = []; const started = performance.now();
  try {
    for (let index = 0; index < clientCount; index++) {
      const client = new WebSocket(url.replace(/^http/, 'ws') + '/realtime', { origin: 'http://localhost:3003' });
      clients.push(client); counts.push(0);
      client.on('message', () => counts[index]++);
      await new Promise((accept, reject) => { const timer = setTimeout(() => reject(new Error('WS connect deadline')), 5000); client.once('open', () => { clearTimeout(timer); accept(); }); client.once('error', (error) => { clearTimeout(timer); reject(error); }); });
    }
    await processBlock(child, fixtureBlock(501), '501');
    const deadline = performance.now() + 5000;
    while (counts.some((count) => count === 0) && performance.now() < deadline) await new Promise((accept) => setTimeout(accept, 50));
    if (counts.some((count) => count === 0)) throw new Error('Not every WebSocket client received a broadcast');
    return { clients: clientCount, receivedByClient: counts, elapsedMs: performance.now() - started };
  } finally {
    await Promise.all(clients.map((client) => new Promise((accept) => { if (client.readyState === WebSocket.CLOSED) return accept(); client.once('close', accept); client.close(); setTimeout(() => { client.terminate(); accept(); }, 1000).unref(); })));
  }
}

export async function benchmarkSystem({ blocks = 20, durationSeconds = 2, concurrency = 2 } = {}) {
  const test = await startTestEnvironment(); let stack;
  try {
    const database = await auditDatabase(test.environment);
    stack = await startApplicationStack(test.environment);
    const child = stack.children.get('indexer-service');
    if (!child) throw new Error('Indexer fixture process unavailable');
    await processBlock(child, fixtureBlock(101), '101');
    const measurements = []; const started = performance.now();
    for (let index = 0; index < blocks; index++) measurements.push(await processBlock(child, fixtureBlock(200 + index), String(200 + index)));
    const elapsedSeconds = (performance.now() - started) / 1000;
    const pool = new Pool({ connectionString: test.environment.databaseUrls.explorer });
    let counts;
    try {
      counts = (await pool.query('SELECT (SELECT count(*)::integer FROM transactions WHERE block_number BETWEEN 200 AND $1) transactions,(SELECT count(*)::integer FROM logs WHERE block_number BETWEEN 200 AND $1) logs,(SELECT count(*)::integer FROM token_transfers WHERE block_number BETWEEN 200 AND $1) transfers', [199 + blocks])).rows[0];
    } finally { await pool.end(); }
    if (counts.transactions !== blocks || counts.logs !== blocks || counts.transfers !== blocks) throw new Error('Benchmark persisted row counts do not match fixture');
    const indexer = { blocks, elapsedSeconds, transactionsPerSecond: counts.transactions / elapsedSeconds, logsPerSecond: counts.logs / elapsedSeconds, tokenTransfersPerSecond: counts.transfers / elapsedSeconds, blockDurationMs: distribution(measurements.map((m) => m.durationMs)), rpcWaitMs: distribution(measurements.map((m) => m.rpcWaitMs)), persistenceMs: distribution(measurements.map((m) => m.persistMs)), measurements };
    console.log(`Indexer: ${blocks} blocks; ${indexer.transactionsPerSecond.toFixed(2)} tx/s, ${indexer.logsPerSecond.toFixed(2)} logs/s, ${indexer.tokenTransfersPerSecond.toFixed(2)} transfers/s; block p95 ${indexer.blockDurationMs.p95} ms`);
    console.log(`Indexer stage p50/p95/p99: RPC ${indexer.rpcWaitMs.p50}/${indexer.rpcWaitMs.p95}/${indexer.rpcWaitMs.p99} ms; DB ${indexer.persistenceMs.p50}/${indexer.persistenceMs.p95}/${indexer.persistenceMs.p99} ms`);
    const register = await fetch(stack.urls.api + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'performance@example.test', password: 'PerformanceFixture!2026', displayName: 'Performance' }) });
    if (!register.ok) throw new Error(`Benchmark auth fixture failed (${register.status})`);
    const auth = await register.json();
    if (typeof auth.accessToken !== 'string') throw new Error('Benchmark JWT fixture unavailable');
    const http = await benchmarkHttp(stack.urls.api, { durationSeconds, concurrency, token: auth.accessToken, search: '101' });
    if (http.endpoints.some((endpoint) => endpoint.errors)) throw new Error('HTTP benchmark returned unsuccessful requests');
    const websocket = await measureWebSocket(stack.urls.api, child, 5);
    console.log(`WebSocket: ${websocket.clients} clients received broadcasts (${websocket.receivedByClient.join(',')}); all clients closed.`);
    return { indexer, http, websocket, database, provider: 'Local deterministic JSON-RPC / CoinGecko / Etherscan fixtures', resourceScope: 'Disposable Testcontainers and child apps; always stopped in finally. Stage waits instrument the existing RPC and Drizzle transaction boundaries only in the test helper.' };
  } finally {
    try { if (stack) await stack.stop(); }
    finally { await test.stop(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await saveReport('system', await benchmarkSystem({ blocks: boundedInteger('PERF_BLOCKS', 20, 1, 100), durationSeconds: boundedInteger('PERF_DURATION_SECONDS', 2, 1, 60), concurrency: boundedInteger('PERF_CONCURRENCY', 2, 1, 32) }));
}
