import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const project = `be-production-test-${runId}`;
const directory = path.join(root, 'tmp', project);
const flags = new Set(process.argv.slice(2));
if ([...flags].some((flag) => !['--config-only', '--skip-build', '--observability'].includes(flag))) throw new Error('Unknown production verification option');
const observe = flags.has('--observability');
const secrets = Object.fromEntries(['POSTGRES_PASSWORD', 'IDENTITY_DB_PASSWORD', 'EXPLORER_DB_PASSWORD', 'PORTFOLIO_DB_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_PASSWORD', 'INTERNAL_SERVICE_TOKEN', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'GRAFANA_ADMIN_PASSWORD'].map((name) => [name, randomBytes(32).toString('hex')]));
const volumes = new Set();
let started = false;
let checks = 0;

function command(args, { visible = false, expected = 0, env = {}, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs ?? (visible ? 1_200_000 : 180_000));
    timeout.unref();
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (visible) process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (visible) process.stderr.write(chunk); });
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Docker could not start')); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === expected) resolve(stdout.trim());
      else {
        for (const secret of Object.values(secrets)) stderr = stderr.replaceAll(secret, '[REDACTED]');
        reject(new Error(`Docker operation failed (${code}): ${stderr.slice(-2_000)}`));
      }
    });
  });
}
const report = (label) => { checks += 1; console.log(`PASS ${checks}: ${label}`); };
const provider = http.createServer(async (request, response) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 32_768) { response.writeHead(413).end(); return; } chunks.push(chunk); }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const result = payload.method === 'eth_chainId' ? '0xaa36a7' : payload.method === 'eth_blockNumber' ? '0x64' : null;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }));
  } catch { response.writeHead(400).end(); }
});
await new Promise((resolve) => provider.listen(0, '0.0.0.0', resolve));
const rpcPort = provider.address().port;
await mkdir(directory, { recursive: true, mode: 0o700 });
const envFile = path.join(directory, '.env.production');
const override = path.join(directory, 'fixture.yml');
const values = {
  ...secrets, POSTGRES_USER: 'blockchain_admin', IMAGE_TAG: 'phase12-verification',
  PROD_API_PORT: '3900', PROD_WEB_PORT: '3903', PROD_GRAFANA_PORT: '3904',
  WEB_ORIGIN: 'http://localhost:3903', NEXT_PUBLIC_API_URL: 'http://localhost:3900', NEXT_PUBLIC_WS_URL: 'ws://localhost:3900/realtime',
  ETHEREUM_RPC_URL: `http://host.docker.internal:${rpcPort}`, INDEXER_ENABLED: 'false',
  EXPLORER_ENRICHMENT_ENABLED: 'false', CONTRACT_VERIFICATION_ENABLED: 'false', TRACE_ENABLED: 'false', PRICE_SCHEDULER_ENABLED: 'false',
  OTEL_ENABLED: observe ? 'true' : 'false', OTEL_SAMPLE_RATIO: '1', OTEL_METRIC_EXPORT_INTERVAL_MS: '1000',
  DEPLOYMENT_ENVIRONMENT: project, API_RATE_LIMIT_ENABLED: 'true', BCRYPT_ROUNDS: '10',
};
await writeFile(envFile, `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n')}\n`, { mode: 0o600 });
await writeFile(override, 'services:\n  api-gateway:\n    restart: "no"\n    extra_hosts: ["host.docker.internal:host-gateway"]\n  indexer-service:\n    restart: "no"\n    extra_hosts: ["host.docker.internal:host-gateway"]\n  portfolio-service:\n    restart: "no"\n    extra_hosts: ["host.docker.internal:host-gateway"]\n  web:\n    restart: "no"\n');
const base = ['compose', '--project-name', project, '--env-file', envFile, '-f', path.join(root, 'infrastructure/compose.production.yml')];
const compose = [...base, ...(observe ? ['-f', path.join(root, 'infrastructure/compose.production.observability.yml')] : []), '-f', override];

async function container(service) {
  const id = await command([...compose, 'ps', '--all', '--quiet', service]);
  assert.match(id, /^[a-f0-9]{64}$/);
  return id;
}
async function internalJson(api, url, auth = false) {
  const script = `const r=await fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(5000),headers:${auth ? "{Authorization:'Basic '+process.env.VERIFY_GRAFANA_AUTH}" : '{}'}});if(!r.ok)throw Error('status '+r.status);console.log(JSON.stringify(await r.json()))`;
  const output = await command(['exec', ...(auth ? ['-e', 'VERIFY_GRAFANA_AUTH'] : []), api, 'node', '--input-type=module', '-e', script], { env: auth ? { VERIFY_GRAFANA_AUTH: Buffer.from(`admin:${secrets.GRAFANA_ADMIN_PASSWORD}`).toString('base64') } : {} });
  return JSON.parse(output);
}

try {
  await command([...compose, 'config', '--quiet']);
  await command([...base, '-f', path.join(root, 'infrastructure/compose.production.observability.yml'), 'config', '--quiet']);
  report('production and optional observability Compose configurations');
  const model = JSON.parse(await command([...compose, 'config', '--format', 'json']));
  for (const name of ['postgres', 'redis', 'rabbitmq', 'indexer-service', 'portfolio-service']) assert.equal(model.services[name].ports, undefined);
  for (const name of ['api-gateway', 'indexer-service', 'portfolio-service', 'web']) {
    assert.equal(model.services[name].read_only, true);
    assert.equal(model.services[name].init, true);
    assert.equal(model.services[name].volumes, undefined);
  }
  report('private dependencies, no source mounts, init and read-only application containers');
  if (flags.has('--config-only')) {
    console.log(`Production configuration checks complete: ${checks} passed`);
  } else {
    assert.equal(await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]), '');
    assert.equal(await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]), '');
    if (!flags.has('--skip-build')) await command([...compose, 'build', 'api-gateway', 'indexer-service', 'portfolio-service', 'web'], { visible: true });
    for (const name of ['api-gateway', 'indexer-service', 'portfolio-service', 'web']) {
      assert.equal(await command(['image', 'inspect', '--format', '{{.Config.User}}', `blockchain-explorer/${name}:phase12-verification`]), 'node');
    }
    report('four pinned production images use a non-root runtime');
    started = true;
    await command([...compose, 'up', '--detach', '--no-build', '--wait', '--wait-timeout', '180']);
    for (const name of (await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])).split('\n').filter(Boolean)) volumes.add(name);
    report('fresh production volumes, three owned migrations and application healthchecks');
    const api = await container('api-gateway');
    for (const name of ['api-gateway', 'indexer-service', 'portfolio-service']) {
      const id = await container(name);
      const proof = await command(['exec', id, 'node', '-e', "const f=require('node:fs');if(f.existsSync('/app/src')||f.existsSync('/app/.env'))process.exit(1);try{require.resolve('@nestjs/cli');process.exit(1)}catch{};console.log('minimal')"]);
      assert.equal(proof, 'minimal');
    }
    report('backend runtime excludes application sources, secrets and Nest CLI');
    for (const route of ['/health', '/stats', '/blocks', '/network/status']) {
      const response = await fetch(`http://localhost:3900${route}`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const payload = await response.json();
      if (route === '/network/status') {
        assert.equal(payload.rpcLatestBlock, '100');
        assert.equal(payload.status, 'stopped');
      }
    }
    report('Dockerized public Gateway HTTP, downstream Explorer and security headers');
    for (const route of ['/', '/blocks', '/login', '/register']) {
      const response = await fetch(`http://localhost:3903${route}`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.match(response.headers.get('content-security-policy'), /http:\/\/localhost:3900/);
      assert.equal(response.headers.get('strict-transport-security'), null);
      assert.match(await response.text(), /<!DOCTYPE html>/i);
    }
    report('standalone frontend serves four production HTML routes');
    const pg = await container('postgres');
    await command(['exec', '-e', 'PGPASSWORD', pg, 'psql', '-h', '127.0.0.1', '-U', 'identity', '-d', 'explorer_db', '-c', 'SELECT 1'], { expected: 2, env: { PGPASSWORD: secrets.IDENTITY_DB_PASSWORD } });
    report('identity role cannot connect to explorer-owned database');
    if (observe) {
      const deadline = Date.now() + 90_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const targets = await internalJson(api, 'http://prometheus:9090/api/v1/targets');
          if (targets.data.activeTargets.length === 6 && targets.data.activeTargets.every((target) => target.health === 'up')) { ready = true; break; }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      assert.equal(ready, true);
      const metrics = await internalJson(api, `http://prometheus:9090/api/v1/query?query=${encodeURIComponent(`count(count by(service_name)(service_up{deployment_environment_name="${project}"}))`)}`);
      assert.equal(metrics.data.result[0]?.value[1], '3');
      const datasources = await internalJson(api, 'http://grafana:3000/api/datasources', true);
      assert.equal(datasources.length, 3);
      for (const source of datasources) assert.equal((await internalJson(api, `http://grafana:3000/api/datasources/uid/${source.uid}/health`, true)).status, 'OK');
      assert.equal((await internalJson(api, 'http://grafana:3000/api/search?type=dash-db', true)).length, 4);
      report('production monitoring: 6/6 targets, three application services, 3/3 datasources and 4/4 dashboards');
    }
    for (const name of ['web', 'api-gateway', 'portfolio-service', 'indexer-service']) {
      const id = await container(name);
      await command([...compose, 'stop', '--timeout', '45', name]);
      const code = await command(['inspect', '--format', '{{.State.ExitCode}}', id]);
      assert.ok(['0', '143'].includes(code), `${name} graceful exit code ${code}`);
    }
    report('SIGTERM application shutdown completes before the 45-second bound');
    await command([...compose, 'up', '--detach', '--no-build', '--wait', '--wait-timeout', '180', 'indexer-service', 'portfolio-service', 'api-gateway']);
    for (const name of ['api-gateway', 'portfolio-service', 'indexer-service']) {
      const id = await container(name);
      const shutdownStarted = Date.now();
      await command(['kill', '--signal', 'SIGINT', id]);
      const code = await command(['wait', id], { timeoutMs: 45_000 });
      assert.ok(['0', '130'].includes(code), `${name} SIGINT exit code ${code}`);
      assert.ok(Date.now() - shutdownStarted < 45_000, `${name} SIGINT shutdown deadline`);
      assert.equal(await command(['inspect', '--format', '{{.State.Running}}', id]), 'false');
    }
    report('SIGINT closes three NestJS backends without hanging or forced termination');
    console.log(`Production Docker checks complete: ${checks} passed${flags.has('--skip-build') ? ' (existing images explicitly reused)' : ''}`);
  }
} finally {
  if (started) {
    for (const name of (await command(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])).split('\n').filter(Boolean)) volumes.add(name);
    await command([...compose, 'down', '--remove-orphans']);
    for (const volume of volumes) {
      const owner = await command(['volume', 'inspect', '--format', '{{index .Labels "com.docker.compose.project"}}', volume]);
      assert.equal(owner, project);
      await command(['volume', 'rm', volume]);
    }
    report('cleanup only the current randomized Compose project and label-proven volumes');
  }
  await new Promise((resolve) => provider.close(resolve));
  const cleanupRoot = path.resolve(root, 'tmp');
  const cleanupTarget = path.resolve(directory);
  assert.ok(cleanupTarget.startsWith(cleanupRoot + path.sep) && path.basename(cleanupTarget) === project, 'Cleanup must remain in this run workspace');
  await rm(directory, { recursive: true, force: true });
}
