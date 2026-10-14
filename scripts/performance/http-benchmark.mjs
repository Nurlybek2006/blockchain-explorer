import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { boundedInteger, distribution, saveReport } from './report.mjs';

export async function benchmarkHttp(baseUrl, { durationSeconds = 3, concurrency = 4, token, search = '100' } = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('PERF_BASE_URL must be an HTTP URL without credentials');
  const paths = ['/health', '/stats', '/blocks?page=1&limit=20', `/search?q=${encodeURIComponent(search)}`];
  if (token) paths.push('/portfolio');
  const endpoints = [];
  for (const path of paths) {
    const latencies = []; const statuses = {}; let success = 0; let errors = 0;
    // Warmup is excluded, including the first cache/provider work.
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(5000) }).then((response) => response.arrayBuffer());
    const started = performance.now(); const deadline = started + durationSeconds * 1000;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const requestStarted = performance.now();
        try {
          const response = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(5000) });
          await response.arrayBuffer(); statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          if (response.ok) success++; else errors++;
        } catch { errors++; statuses.network = (statuses.network ?? 0) + 1; }
        latencies.push(performance.now() - requestStarted);
      }
    }));
    const elapsedSeconds = (performance.now() - started) / 1000;
    const result = { path, requests: success + errors, success, errors, throughput: Number(((success + errors) / elapsedSeconds).toFixed(2)), elapsedSeconds, latencyMs: distribution(latencies), statuses };
    endpoints.push(result);
    console.log(`${path}: ${result.requests} requests, ${success} successful, ${errors} errors, ${result.throughput} req/s; p50/p95/p99 ${result.latencyMs.p50}/${result.latencyMs.p95}/${result.latencyMs.p99} ms`);
  }
  return { durationSeconds, concurrency, endpoints };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await benchmarkHttp(process.env.PERF_BASE_URL ?? 'http://localhost:3000', {
    durationSeconds: boundedInteger('PERF_DURATION_SECONDS', 5, 1, 60), concurrency: boundedInteger('PERF_CONCURRENCY', 4, 1, 32), token: process.env.PERF_ACCESS_TOKEN,
  });
  await saveReport('http', report);
  if (report.endpoints.some((endpoint) => endpoint.errors)) process.exitCode = 1;
}
