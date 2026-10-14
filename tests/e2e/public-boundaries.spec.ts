import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { RabbitMqClient } from '@blockchain-explorer/messaging';
import { createEventEnvelope, EVENT_TYPES } from '@blockchain-explorer/contracts';
import type { AuthResponse } from '@blockchain-explorer/contracts';
import { decodeAuth } from '../../apps/web/src/lib/api/auth.api.js';
import { array, eventually, record, string } from '../helpers/assertions.js';
import { freePort, processBlock, startApplicationStack, stopApplication, type ApplicationStack } from '../helpers/application-stack.js';
import { blockHash, contract, decimalAmount, fixtureBlock, hash, recipient, token, wallet } from '../helpers/provider-fixtures.js';

describe('real public services, auth, ownership, outbox and realtime boundaries', () => {
  let stack: ApplicationStack;
  let identity: Pool;
  let explorer: Pool;
  let portfolio: Pool;
  let userA: AuthResponse;
  let userB: AuthResponse;
  let portfolioId: string;
  let watchlistId: string;
  let alertId: string;
  const password = 'Testcontainers-strong-password-2026';

  async function request(method: string, path: string, expected: number, body?: unknown, access?: string, base?: string): Promise<unknown> {
    const response = await fetch(`${base ?? stack.urls.api}${path}`, { method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(access ? { Authorization: `Bearer ${access}` } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    expect(response.status, `${method} ${path}: ${text}`).toBe(expected);
    if (text.length === 0) return undefined;
    const result: unknown = JSON.parse(text);
    if (expected >= 400) {
      const error = record(result); expect(error).not.toHaveProperty('stack');
      expect(text).not.toContain('password_hash'); expect(text).not.toContain('postgresql://');
    }
    return result;
  }
  async function register(label: string): Promise<AuthResponse> {
    return decodeAuth(await request('POST', '/auth/register', 201, { email: `${label}-${randomUUID()}@example.test`, password, displayName: label }));
  }
  function accessToken(user: AuthResponse, secret: string, expired = false): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ sub: user.user.id, email: user.user.email, role: user.user.role, type: 'access', iat: now - 20, exp: expired ? now - 10 : now + 60 }, secret,
      { algorithm: 'HS256', issuer: 'blockchain-explorer', audience: 'blockchain-explorer:api' });
  }

  beforeAll(async () => {
    const environment = inject('environment');
    identity = new Pool({ connectionString: environment.databaseUrls.identity });
    explorer = new Pool({ connectionString: environment.databaseUrls.explorer });
    portfolio = new Pool({ connectionString: environment.databaseUrls.portfolio });
    stack = await startApplicationStack(environment);
    userA = await register('owner-a'); userB = await register('owner-b');
    portfolioId = string(record(await request('POST', '/portfolio', 201, { name: 'Private Portfolio', walletAddress: wallet }, userA.accessToken)).id);
    watchlistId = string(record(await request('POST', '/watchlists', 201, { name: 'Private Watchlist' }, userA.accessToken)).id);
    alertId = string(record(await request('POST', '/alerts', 201, { type: 'wallet_activity', walletAddress: wallet }, userA.accessToken)).id);
  });
  afterAll(async () => { if (stack) await stack.stop(); await Promise.all([identity?.end(), explorer?.end(), portfolio?.end()]); });

  for (const service of ['api', 'indexer', 'portfolio'] as const) {
    it(`${service} exposes healthy HTTP with actual storage and broker`, async () => {
      const result = record(await request('GET', '/health', 200, undefined, undefined, stack.urls[service]));
      expect(result.status).toBe('ok');
    });
  }
  it('register/login/me public contracts and hashed passwords are real', async () => {
    const login = decodeAuth(await request('POST', '/auth/login', 200, { email: userA.user.email, password }));
    const me = record(await request('GET', '/users/me', 200, undefined, login.accessToken)); expect(me.id).toBe(userA.user.id);
    const stored = (await identity.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [userA.user.id])).rows[0];
    expect(stored?.password_hash).toMatch(/^\$2[ab]\$10\$/); expect(stored?.password_hash).not.toBe(password);
    expect(me).not.toHaveProperty('passwordHash');
  });
  it('duplicate registration is case-insensitive and returns conflict', async () => {
    await request('POST', '/auth/register', 409, { email: userA.user.email.toUpperCase(), password });
  });
  it.each([{ email: 'invalid', password }, { email: 'valid@example.test', password: 'short' }, { email: 'valid@example.test', password, displayName: 'x'.repeat(101) }, { email: 'valid@example.test', password: '💥'.repeat(30) }])('rejects invalid auth fields %#', async (body) => {
    await request('POST', '/auth/register', 400, body);
  });
  it('wrong password and unknown email share the unauthorized response', async () => {
    const wrong = await request('POST', '/auth/login', 401, { email: userA.user.email, password: 'wrong-password' });
    const unknown = await request('POST', '/auth/login', 401, { email: 'unknown@example.test', password: 'wrong-password' });
    expect(record(wrong).message).toBe(record(unknown).message);
  });
  it('inactive users cannot login, refresh or use a previously issued access token', async () => {
    const user = await register('inactive');
    await identity.query('UPDATE users SET is_active=false WHERE id=$1', [user.user.id]);
    await request('POST', '/auth/login', 401, { email: user.user.email, password });
    await request('POST', '/auth/refresh', 401, { refreshToken: user.refreshToken });
    await request('GET', '/users/me', 401, undefined, user.accessToken);
  });
  it('missing, malformed and invalid-signature JWT cannot access protected routes', async () => {
    await request('GET', '/portfolio', 401);
    await request('GET', '/portfolio', 401, undefined, 'not-a-jwt');
    await request('GET', '/portfolio', 401, undefined, accessToken(userA, 'incorrect-signature-secret-32bytes-long'));
  });
  it('expired access token is rejected by actual JWT guard', async () => {
    await request('GET', '/users/me', 401, undefined, accessToken(userA, string(stack.env.JWT_ACCESS_SECRET), true));
  });
  it('expired refresh database record is revoked and cannot rotate', async () => {
    const user = await register('refresh-expired');
    await identity.query("UPDATE refresh_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1", [user.user.id]);
    await request('POST', '/auth/refresh', 401, { refreshToken: user.refreshToken });
    expect((await identity.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM refresh_tokens WHERE user_id=$1', [user.user.id])).rows[0]?.revoked_at).not.toBeNull();
  });
  it('expired refresh JWT cannot pass verification even when signed correctly', async () => {
    const user = await register('jwt-refresh-expired');
    const now = Math.floor(Date.now() / 1000);
    const refresh = jwt.sign({ sub: user.user.id, jti: randomUUID(), familyId: randomUUID(), type: 'refresh', iat: now - 20, exp: now - 10 }, string(stack.env.JWT_REFRESH_SECRET),
      { algorithm: 'HS256', issuer: 'blockchain-explorer', audience: 'blockchain-explorer:api' });
    await request('POST', '/auth/refresh', 401, { refreshToken: refresh });
  });
  it('refresh rotation replaces token, stores only hashes and reuse revokes the whole family', async () => {
    const user = await register('rotation');
    const rotated = decodeAuth(await request('POST', '/auth/refresh', 200, { refreshToken: user.refreshToken }));
    expect(rotated.refreshToken).not.toBe(user.refreshToken);
    const hashes = await identity.query<{ token_hash: string; revoked_at: Date | null }>('SELECT token_hash,revoked_at FROM refresh_tokens WHERE user_id=$1', [user.user.id]);
    expect(hashes.rows).toHaveLength(2);
    expect(hashes.rows.map((row) => row.token_hash)).toContain(createHash('sha256').update(user.refreshToken).digest('hex'));
    expect(hashes.rows.some((row) => row.token_hash === user.refreshToken)).toBe(false);
    await request('POST', '/auth/refresh', 401, { refreshToken: user.refreshToken });
    await request('POST', '/auth/refresh', 401, { refreshToken: rotated.refreshToken });
    expect((await identity.query<{ count: string }>('SELECT count(*) FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [user.user.id])).rows[0]?.count).toBe('0');
  });
  it('concurrent refresh has only one winner and replay protection revokes descendants', async () => {
    const user = await register('concurrent-refresh');
    const responses = await Promise.all([1, 2].map(() => fetch(`${stack.urls.api}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: user.refreshToken }) })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const success = responses.find((response) => response.status === 200); if (!success) throw new Error('Refresh winner missing');
    const rotated = decodeAuth(await success.json());
    await request('POST', '/auth/refresh', 401, { refreshToken: rotated.refreshToken });
  });
  it('logout revokes one session family and logout-all revokes independent sessions', async () => {
    const user = await register('logout');
    const separate = decodeAuth(await request('POST', '/auth/login', 200, { email: user.user.email, password }));
    await request('POST', '/auth/logout', 204, { refreshToken: user.refreshToken });
    await request('POST', '/auth/refresh', 401, { refreshToken: user.refreshToken });
    const stillActive = decodeAuth(await request('POST', '/auth/refresh', 200, { refreshToken: separate.refreshToken }));
    await request('POST', '/auth/logout-all', 204, undefined, stillActive.accessToken);
    await request('POST', '/auth/refresh', 401, { refreshToken: stillActive.refreshToken });
  });

  for (const resource of ['portfolio', 'watchlists', 'alerts'] as const) {
    it(`owner B cannot enumerate GET/PATCH/DELETE of owner A ${resource}`, async () => {
      const id = resource === 'portfolio' ? portfolioId : resource === 'watchlists' ? watchlistId : alertId;
      await request('GET', `/${resource}/${id}`, 404, undefined, userB.accessToken);
      await request('PATCH', `/${resource}/${id}`, 404, resource === 'alerts' ? { enabled: false } : { name: 'stolen' }, userB.accessToken);
      await request('DELETE', `/${resource}/${id}`, 404, undefined, userB.accessToken);
      const unknown = await request('GET', `/${resource}/${randomUUID()}`, 404, undefined, userB.accessToken);
      expect(record(unknown).statusCode).toBe(404);
      await request('GET', `/${resource}/${id}`, 200, undefined, userA.accessToken);
    });
  }
  it('portfolio holdings/history/analytics ownership is enforced before data reads', async () => {
    for (const endpoint of ['holdings', 'history', 'analytics', 'valuation']) await request('GET', `/portfolio/${portfolioId}/${endpoint}`, 404, undefined, userB.accessToken);
  });
  it('authenticated public portfolio/watchlist/alert regression completes CRUD and reads', async () => {
    await request('GET', '/portfolio', 200, undefined, userA.accessToken);
    await request('PATCH', `/portfolio/${portfolioId}`, 200, { name: 'Renamed' }, userA.accessToken);
    for (const endpoint of ['holdings', 'history', 'analytics', 'valuation']) await request('GET', `/portfolio/${portfolioId}/${endpoint}`, 200, undefined, userA.accessToken);
    const item = record(await request('POST', `/watchlists/${watchlistId}/items`, 201, { itemType: 'token', address: token, label: 'TC' }, userA.accessToken));
    await request('GET', `/watchlists/${watchlistId}`, 200, undefined, userA.accessToken);
    await request('DELETE', `/watchlists/${watchlistId}/items/${string(item.id)}`, 204, undefined, userA.accessToken);
    await request('GET', '/watchlists', 200, undefined, userA.accessToken);
    await request('GET', '/alerts', 200, undefined, userA.accessToken);
    await request('GET', '/alerts/events', 200, undefined, userA.accessToken);
    await request('PATCH', `/alerts/${alertId}`, 200, { enabled: false }, userA.accessToken);
    const disposable = string(record(await request('POST', '/portfolio', 201, { name: 'Remove', walletAddress: recipient }, userA.accessToken)).id);
    await request('DELETE', `/portfolio/${disposable}`, 204, undefined, userA.accessToken);
    await request('GET', `/portfolio/${disposable}`, 404, undefined, userA.accessToken);
  });
  it('internal endpoints reject missing/wrong service token and public user JWT', async () => {
    for (const base of [stack.urls.indexer, stack.urls.portfolio]) {
      const path = base === stack.urls.indexer ? '/internal/explorer/stats' : `/internal/portfolios?userId=${userA.user.id}`;
      await request('GET', path, 401, undefined, undefined, base);
      await request('GET', path, 401, undefined, userA.accessToken, base);
      const wrong = await fetch(`${base}${path}`, { headers: { 'x-internal-service-token': 'incorrect' } }); expect(wrong.status).toBe(401);
      const good = await fetch(`${base}${path}`, { headers: { 'x-internal-service-token': string(stack.env.INTERNAL_SERVICE_TOKEN) } }); expect(good.status).toBe(200);
    }
    await request('GET', '/internal/explorer/stats', 404);
  });
  it.each(['/address/invalid', '/tx/0x1234', '/blocks/-1', '/blocks/9223372036854775808', '/portfolio/invalid-uuid', '/blocks?page=-1', '/blocks?limit=100001', '/search?q=bad', '/search?q=' + 'x'.repeat(101), '/search?q=101&q=102'])('invalid public input is bounded: %s', async (path) => {
    await request('GET', path, 400, undefined, userA.accessToken);
  });
  it('portfolio/watchlist names, UUID ownership injection and alert thresholds are validated', async () => {
    await request('POST', '/portfolio', 400, { name: 'x'.repeat(101), walletAddress: wallet }, userA.accessToken);
    await request('POST', '/portfolio', 400, { name: 'valid', walletAddress: 'invalid' }, userA.accessToken);
    await request('POST', '/portfolio', 400, { name: 'valid', walletAddress: wallet, userId: userB.user.id }, userA.accessToken);
    await request('POST', '/watchlists', 400, { name: 'x'.repeat(101) }, userA.accessToken);
    for (const thresholdUsd of ['-1', '0', '9'.repeat(61), 1000]) await request('POST', '/alerts', 400, { type: 'price_above', thresholdUsd }, userA.accessToken);
  });

  it('security headers, exact CORS and authorized OPTIONS preflight are compatible', async () => {
    const response = await fetch(`${stack.urls.api}/health`, { headers: { Origin: string(stack.env.WEB_ORIGIN) } });
    expect(response.status).toBe(200); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).not.toBeNull(); expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('permissions-policy')).not.toBeNull(); expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe(stack.env.WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    const blocked = await fetch(`${stack.urls.api}/health`, { headers: { Origin: 'https://attacker.example' } }); expect(blocked.status).toBe(403);
    const preflight = await fetch(`${stack.urls.api}/auth/login`, { method: 'OPTIONS', headers: { Origin: string(stack.env.WEB_ORIGIN), 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-request-id' } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });
  it('malformed JSON, huge JSON and scalar bodies are controlled errors with request ID', async () => {
    for (const [body, expected] of [['{bad', 400], ['"scalar"', 400], [JSON.stringify({ email: 'x'.repeat(70_000) }), 413]] as const) {
      const response = await fetch(`${stack.urls.api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': 'phase12-body-test' }, body });
      expect(response.status).toBe(expected); expect(response.headers.get('x-request-id')).toBe('phase12-body-test');
      const content = await response.text(); expect(content).not.toContain('stack'); expect(content).not.toContain('SyntaxError');
    }
    await request('GET', '/health', 200);
  });

  it('actual BlockProcessor commits canonical entities and outbox then publisher confirms them', async () => {
    const indexer = stack.children.get('indexer-service'); if (!indexer) throw new Error('Indexer missing');
    await processBlock(indexer, fixtureBlock());
    expect((await explorer.query<{ number: string }>('SELECT number FROM blocks WHERE number=101')).rows[0]?.number).toBe('101');
    expect((await explorer.query<{ amount: string }>('SELECT amount FROM token_transfers WHERE transaction_hash=$1', [hash])).rows[0]?.amount).toBe(decimalAmount);
    const committed = await explorer.query<{ payload: unknown; status: string }>('SELECT payload,status FROM outbox_events WHERE aggregate_id=$1', ['101']);
    expect(committed.rows).toHaveLength(1); expect(record(committed.rows[0]?.payload).type).toBe(EVENT_TYPES.BLOCK_INDEXED);
    await eventually(() => explorer.query<{ status: string }>('SELECT status FROM outbox_events WHERE aggregate_id=$1', ['101']), (result) => result.rows[0]?.status === 'published');
    await request('GET', '/stats', 200); await request('GET', '/blocks', 200); await request('GET', '/blocks/101', 200);
    await request('GET', `/blocks/hash/${blockHash}`, 200); await request('GET', `/tx/${hash}`, 200);
    await request('GET', `/address/${wallet}`, 200); await request('GET', `/token/${token}`, 200);
    expect(record(await request('GET', '/search?q=101', 200)).destination).toBe('/blocks/101');
    expect(record(await request('GET', '/network/status', 200)).chainId).toBe(11155111);
  });
  it('constraint failure rolls back block, transaction, transfer and outbox together', async () => {
    const indexer = stack.children.get('indexer-service'); if (!indexer) throw new Error('Indexer missing');
    await explorer.query("ALTER TABLE outbox_events ADD CONSTRAINT tc_reject_block CHECK (aggregate_id <> '102') NOT VALID");
    try {
      await expect(processBlock(indexer, fixtureBlock(102), '102')).rejects.toThrow();
      expect((await explorer.query('SELECT number FROM blocks WHERE number=102')).rows).toHaveLength(0);
      expect((await explorer.query('SELECT hash FROM transactions WHERE block_number=102')).rows).toHaveLength(0);
      expect((await explorer.query('SELECT id FROM token_transfers WHERE block_number=102')).rows).toHaveLength(0);
      expect((await explorer.query("SELECT id FROM outbox_events WHERE aggregate_id='102'")).rows).toHaveLength(0);
    } finally { await explorer.query('ALTER TABLE outbox_events DROP CONSTRAINT tc_reject_block'); }
  });
  it('background verification and actual callTracer worker expose correct source and Internal Calls', async () => {
    const verification = await eventually(async () => {
      const response = await fetch(`${stack.urls.api}/contract/${contract}`); return response.ok ? record(await response.json()) : null;
    }, (value) => value !== null && record(value.verification).status === 'verified', 25_000);
    expect(record(verification?.verification).sourceCode).toBe('contract Fixture {}');
    const traces = await eventually(async () => record(await request('GET', `/tx/${hash}/traces`, 200)), (value) => value.status === 'completed', 25_000);
    expect(traces.available).toBe(true); expect(array(traces.traces)).toHaveLength(2); expect(array(traces.internalCalls)).toHaveLength(1);
    expect(record(array(traces.internalCalls)[0]).value).toBe('2');
  });
  it('multiple native WebSocket clients broadcast once, reject bad Origin and reconnect safely', async () => {
    const sockets = [1, 2, 3].map(() => new WebSocket(`${stack.urls.api.replace('http', 'ws')}/realtime`, { origin: string(stack.env.WEB_ORIGIN) }));
    const received = sockets.map(() => [] as unknown[]);
    for (const [index, socket] of sockets.entries()) { socket.on('error', () => undefined); socket.on('message', (data) => received[index]?.push(JSON.parse(data.toString()))); }
    const publisher = new RabbitMqClient({ url: inject('environment').rabbitUrl, exchange: string(stack.env.RABBITMQ_EXCHANGE) });
    try {
      await Promise.all(sockets.map((socket) => new Promise<void>((accept, reject) => { socket.once('open', () => accept()); socket.once('error', reject); })));
      const denied = new WebSocket(`${stack.urls.api.replace('http', 'ws')}/realtime`, { origin: 'https://attacker.example' });
      await new Promise<void>((accept, reject) => { denied.once('unexpected-response', (_, response) => { expect(response.statusCode).toBe(403); response.resume(); denied.terminate(); accept(); }); denied.once('open', () => reject(new Error('Disallowed Origin connected'))); denied.on('error', () => undefined); });
      const event = createEventEnvelope(EVENT_TYPES.BLOCK_INDEXED, 'indexer-service', { chainId: 11155111, networkName: 'ethereum-sepolia', blockNumber: '101', blockHash, parentHash: blockHash, timestamp: new Date().toISOString(), transactionCount: 1, logCount: 1, tokenTransferCount: 1 });
      await publisher.publish(event); await publisher.publish(event);
      await eventually(async () => received, (groups) => groups.every((group) => group.some((value) => record(value).id === event.id)));
      await delay(200);
      for (const group of received) expect(group.filter((value) => record(value).id === event.id)).toHaveLength(1);
      sockets[0]?.terminate();
      const reconnect = new WebSocket(`${stack.urls.api.replace('http', 'ws')}/realtime`, { origin: string(stack.env.WEB_ORIGIN) });
      reconnect.on('error', () => undefined);
      await new Promise<void>((accept, reject) => { reconnect.once('open', () => accept()); reconnect.once('error', reject); }); reconnect.close();
      expect(record(received[1]?.[0])).not.toHaveProperty('metadata');
    } finally { sockets.forEach((socket) => socket.terminate()); await publisher.close(); }
  });
  it('RabbitMQ outage does not lose indexed entities/outbox and recovery publishes the pending event', async () => {
    const environment = inject('environment');
    const indexer = stack.children.get('indexer-service'); if (!indexer) throw new Error('Indexer missing');
    const consumer = new RabbitMqClient({ url: environment.rabbitUrl, exchange: string(stack.env.RABBITMQ_EXCHANGE) });
    const queue = `tc.${environment.runId}.outbox-recovery`; const events: unknown[] = [];
    await consumer.consume({ queue, routingKeys: [EVENT_TYPES.BLOCK_INDEXED] }, async (event) => { events.push(event); });
    const docker = promisify(execFile);
    let stopped = false;
    try {
      await docker('docker', ['exec', environment.rabbitId, 'rabbitmqctl', 'stop_app'], { windowsHide: true, timeout: 20_000 }); stopped = true;
      await delay(300);
      await processBlock(indexer, fixtureBlock(103), '103');
      expect((await explorer.query('SELECT number FROM blocks WHERE number=103')).rows).toHaveLength(1);
      const pending = await eventually(() => explorer.query<{ status: string; attempts: number }>("SELECT status,attempts FROM outbox_events WHERE aggregate_id='103'"), (result) => result.rows[0]?.status === 'pending' && (result.rows[0]?.attempts ?? 0) > 0);
      expect(pending.rows[0]?.status).toBe('pending');
      await docker('docker', ['exec', environment.rabbitId, 'rabbitmqctl', 'start_app'], { windowsHide: true, timeout: 30_000 }); stopped = false;
      await consumer.consume({ queue, routingKeys: [EVENT_TYPES.BLOCK_INDEXED] }, async (event) => { events.push(event); });
      await eventually(() => explorer.query<{ status: string; published_at: Date | null }>("SELECT status,published_at FROM outbox_events WHERE aggregate_id='103'"), (result) => result.rows[0]?.status === 'published' && result.rows[0]?.published_at !== null, 25_000);
      await eventually(async () => events, (values) => values.some((value) => record(record(value).payload).blockNumber === '103'), 25_000);
    } finally {
      if (stopped) await docker('docker', ['exec', environment.rabbitId, 'rabbitmqctl', 'start_app'], { windowsHide: true, timeout: 30_000 });
      await consumer.close();
    }
  }, 90_000);
  it('Redis unavailable public reads degrade while auth rate limiting fails closed', async () => {
    const port = await freePort();
    const child = await stack.launch('api-gateway', { API_GATEWAY_PORT: String(port), REDIS_URL: 'redis://127.0.0.1:1', REALTIME_ENABLED: 'false', CACHE_PREFIX: `tc:offline:${randomUUID()}` }, 503);
    try {
      const base = `http://127.0.0.1:${port}`;
      await request('GET', '/stats', 200, undefined, undefined, base);
      await request('GET', '/search?q=101', 200, undefined, undefined, base);
      await request('POST', '/auth/login', 503, { email: userA.user.email, password }, undefined, base);
    } finally { await stopApplication(child); }
  });
  it('atomic distributed rate limit rejects abuse, ignores spoofed XFF and resets its window', async () => {
    const port = await freePort();
    const child = await stack.launch('api-gateway', { API_GATEWAY_PORT: String(port), REALTIME_ENABLED: 'false', RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_SEARCH_MAX: '2', RATE_LIMIT_WINDOW_MS: '1000', CACHE_PREFIX: `tc:limited:${randomUUID()}` });
    try {
      const base = `http://127.0.0.1:${port}`;
      const statuses = await Promise.all([1, 2, 3, 4].map((id) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `192.0.2.${id}` }, body: JSON.stringify({ email: 'unknown@example.test', password }) })));
      expect(statuses.map((response) => response.status).sort()).toEqual([401, 401, 429, 429]);
      const rejected = statuses.find((response) => response.status === 429); expect(rejected?.headers.get('retry-after')).not.toBeNull();
      await eventually(async () => (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.test', password }) })).status, (status) => status === 401, 3000);
      const search = await Promise.all([1, 2, 3].map(() => fetch(`${base}/search?q=101`))); expect(search.map((response) => response.status).sort()).toEqual([200, 200, 429]);
    } finally { await stopApplication(child); }
  });
  it('unavailable OTel Collector keeps HTTP useful and telemetry shutdown remains bounded', async () => {
    const port = await freePort();
    const child = await stack.launch('api-gateway', { API_GATEWAY_PORT: String(port), REALTIME_ENABLED: 'false', OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', OTEL_METRIC_EXPORT_INTERVAL_MS: '1000', CACHE_PREFIX: `tc:telemetry-offline:${randomUUID()}` });
    try {
      const base = `http://127.0.0.1:${port}`;
      await request('GET', '/health', 200, undefined, undefined, base);
      await request('GET', '/stats', 200, undefined, undefined, base);
      await delay(1100);
      await request('GET', '/stats', 200, undefined, undefined, base);
    } finally { await stopApplication(child); }
  });
  it('Nest SIGTERM shutdown closes HTTP, workers, broker, Redis, database and telemetry without hanging', async () => {
    for (const [name, child] of stack.children) {
      await stopApplication(child); expect(child.exitCode).toBe(0);
      const log = stack.output.get(name) ?? ''; expect(log).not.toContain('UnhandledPromiseRejection');
    }
  });
});
