import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import amqp from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { Pool } from 'pg';
import { BullMqFactory, RabbitMqClient, RedisCacheClient } from '@blockchain-explorer/messaging';
import { createEventEnvelope, isEventEnvelope } from '@blockchain-explorer/contracts';
import { eventually } from '../helpers/assertions.js';

describe('real Redis, BullMQ and RabbitMQ guarantees', () => {
  let cache: RedisCacheClient;
  let broker: ChannelModel;
  let channel: ConfirmChannel;
  let database: Pool;
  const clients: RabbitMqClient[] = [];
  const exchange = `tc.${randomUUID()}.events`;

  beforeAll(async () => {
    const environment = inject('environment');
    cache = new RedisCacheClient({ url: environment.redisUrl, prefix: `tc:${environment.runId}` });
    await cache.connect();
    broker = await amqp.connect(environment.rabbitUrl); broker.on('error', () => undefined);
    channel = await broker.createConfirmChannel();
    database = new Pool({ connectionString: environment.databaseUrls.portfolio });
  });
  afterAll(async () => { await Promise.all(clients.map((client) => client.close())); await channel.close(); await broker.close(); await cache.close(); await database.end(); });

  it('cache hit, miss, delete and namespace isolation use actual Redis', async () => {
    const other = new RedisCacheClient({ url: inject('environment').redisUrl, prefix: `tc:other:${randomUUID()}` });
    try {
      expect(await cache.getJson('explorer:missing')).toBeNull();
      await cache.setJson('explorer:hit', { quantity: '900719925474099300001' }, 30);
      expect(await cache.getJson('explorer:hit')).toEqual({ quantity: '900719925474099300001' });
      expect(await other.getJson('explorer:hit')).toBeNull();
      await cache.delete('explorer:hit'); expect(await cache.getJson('explorer:hit')).toBeNull();
    } finally { await other.close(); }
  });
  it('Redis TTL expires cached data', async () => {
    await cache.setJson('explorer:ttl', { value: 'short-lived' }, 1);
    expect(await cache.getJson('explorer:ttl')).not.toBeNull();
    await eventually(() => cache.getJson('explorer:ttl'), (value) => value === null, 3000);
  });
  it('Redis fixed window is atomic across concurrent clients and expires without sliding extension', async () => {
    const environment = inject('environment');
    const prefix = `tc:rate:${randomUUID()}`;
    const first = new RedisCacheClient({ url: environment.redisUrl, prefix });
    const second = new RedisCacheClient({ url: environment.redisUrl, prefix });
    try {
      await Promise.all([first.connect(), second.connect()]);
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? first : second).consumeFixedWindow('auth:fixed-ip', 3, 1000)));
      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.filter((result) => !result.allowed).every((result) => result.retryAfterMs > 0 && result.retryAfterMs <= 1000)).toBe(true);
      expect(results.filter((result) => result.allowed).every((result) => result.retryAfterMs === 0)).toBe(true);
      await setTimeout(1100);
      expect((await second.consumeFixedWindow('auth:fixed-ip', 3, 1000)).allowed).toBe(true);
      expect((await first.consumeFixedWindow('search:fixed-ip', 1, 1000)).allowed).toBe(true);
    } finally { await first.close(); await second.close(); }
  });
  it('SCAN invalidation deletes only the literal selected prefix', async () => {
    await cache.setJson('explorer:blocks:1', 'blocks', 30);
    await cache.setJson('explorer:stats', 'stats', 30);
    await cache.setJson('portfolio:safe', 'portfolio', 30);
    await cache.deletePrefix('explorer:');
    expect(await cache.getJson('explorer:stats')).toBeNull();
    expect(await cache.getJson('explorer:blocks:1')).toBeNull();
    expect(await cache.getJson('portfolio:safe')).toBe('portfolio');
    await expect(cache.deletePrefix('*')).rejects.toThrow();
  });
  it('BullMQ stable job ID deduplicates enqueue and worker returns typed result', async () => {
    const factory = new BullMqFactory({ redisUrl: inject('environment').redisUrl });
    const name = `tc-${randomUUID()}-dedup`;
    const queue = factory.createQueue<{ quantity: string }, string, 'sync-token-holding'>(name);
    let executions = 0;
    const worker = factory.createWorker<{ quantity: string }, string, 'sync-token-holding'>(name, async (job) => { executions++; return job.data.quantity; }, 1);
    worker.on('error', () => undefined);
    try {
      const first = await queue.add('sync-token-holding', { quantity: '900719925474099300001' }, { jobId: 'stable-id' });
      const second = await queue.add('sync-token-holding', { quantity: 'wrong duplicate' }, { jobId: 'stable-id' });
      expect(second.id).toBe(first.id);
      const job = await eventually(() => queue.getJob('stable-id'), (job) => job?.returnvalue === '900719925474099300001');
      expect(job?.returnvalue).toBe('900719925474099300001'); expect(executions).toBe(1);
    } finally { await worker.close(); await queue.obliterate({ force: true }); await queue.close(); }
  });
  it('BullMQ retry/backoff succeeds after two failures and records attempts', async () => {
    const factory = new BullMqFactory({ redisUrl: inject('environment').redisUrl });
    const name = `tc-${randomUUID()}-retry`;
    const queue = factory.createQueue<{ action: string }, string, 'rebuild-portfolio'>(name, { attempts: 3, backoff: { type: 'exponential', delay: 100 } });
    const starts: number[] = [];
    const worker = factory.createWorker<{ action: string }, string, 'rebuild-portfolio'>(name, async () => {
      starts.push(Date.now()); if (starts.length < 3) throw new Error('Controlled transient failure'); return 'rebuilt';
    }, 1);
    worker.on('error', () => undefined);
    try {
      await queue.add('rebuild-portfolio', { action: 'rebuild' }, { jobId: 'retry-id' });
      const job = await eventually(() => queue.getJob('retry-id'), (job) => job?.returnvalue === 'rebuilt');
      expect(job?.attemptsMade).toBe(3); expect(starts.length).toBe(3);
      expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(90);
      expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(190);
    } finally { await worker.close(); await queue.obliterate({ force: true }); await queue.close(); }
  });
  it('BullMQ permanent failure is bounded and retained for inspection', async () => {
    const factory = new BullMqFactory({ redisUrl: inject('environment').redisUrl });
    const name = `tc-${randomUUID()}-failed`;
    const queue = factory.createQueue<{ action: string }, string, 'rebuild-portfolio'>(name, { attempts: 2, backoff: { type: 'fixed', delay: 50 } });
    let attempts = 0;
    const worker = factory.createWorker<{ action: string }, string, 'rebuild-portfolio'>(name, async () => { attempts++; throw new Error('Controlled permanent failure'); }, 1);
    worker.on('error', () => undefined);
    try {
      await queue.add('rebuild-portfolio', { action: 'invalid' }, { jobId: 'failed-id' });
      await eventually(() => queue.getFailedCount(), (value) => value === 1);
      const job = await queue.getJob('failed-id'); expect(job?.attemptsMade).toBe(2); expect(attempts).toBe(2);
      expect(job?.failedReason).toBe('Controlled permanent failure');
    } finally { await worker.close(); await queue.obliterate({ force: true }); await queue.close(); }
  });

  it('RabbitMQ durable topic routing, confirms and ACK preserve the event envelope', async () => {
    const client = new RabbitMqClient({ url: inject('environment').rabbitUrl, exchange }); clients.push(client);
    const queue = `tc.${randomUUID()}.ack`; const received: string[] = [];
    await client.consume({ queue, routingKeys: ['test.accepted.v1'] }, async (event) => { expect(isEventEnvelope(event)).toBe(true); received.push(event.id); });
    const accepted = createEventEnvelope('test.accepted.v1', 'integration-test', { amount: '9007199254740993' });
    await client.publish(createEventEnvelope('test.other.v1', 'integration-test', {}));
    await client.publish(accepted);
    await eventually(async () => received, (ids) => ids.includes(accepted.id));
    await setTimeout(100); expect(received).toEqual([accepted.id]);
    expect((await channel.checkQueue(queue)).messageCount).toBe(0);
  });
  it('RabbitMQ handler failure NACKs without requeue and dead-letters once', async () => {
    const client = new RabbitMqClient({ url: inject('environment').rabbitUrl, exchange }); clients.push(client);
    const queue = `tc.${randomUUID()}.nack`; let executions = 0;
    await client.consume({ queue, routingKeys: ['test.failure.v1'] }, async () => { executions++; throw new Error('Controlled consumer failure'); });
    const event = createEventEnvelope('test.failure.v1', 'integration-test', { retryable: false });
    await client.publish(event);
    const dead = await eventually(() => channel.get(`${queue}.dlq`, { noAck: true }), (message) => message !== false);
    if (!dead) throw new Error('DLQ delivery missing');
    expect(JSON.parse(dead.content.toString('utf8'))).toEqual(event);
    expect(dead.properties.headers?.['x-death']).toBeDefined();
    await setTimeout(150); expect(executions).toBe(1); expect((await channel.checkQueue(queue)).messageCount).toBe(0);
  });
  it('malformed broker JSON and invalid envelope are rejected to DLQ', async () => {
    const client = new RabbitMqClient({ url: inject('environment').rabbitUrl, exchange }); clients.push(client);
    const queue = `tc.${randomUUID()}.malformed`; let executions = 0;
    await client.consume({ queue, routingKeys: ['test.malformed.v1'] }, async () => { executions++; });
    channel.publish(exchange, 'test.malformed.v1', Buffer.from('{bad json'), { persistent: true });
    channel.publish(exchange, 'test.malformed.v1', Buffer.from(JSON.stringify({ payload: {} })), { persistent: true });
    await channel.waitForConfirms();
    await eventually(() => channel.checkQueue(`${queue}.dlq`), (result) => result.messageCount === 2);
    expect(executions).toBe(0);
  });
  it('duplicate delivery uses a PostgreSQL unique event ID transaction and ACKs both', async () => {
    const client = new RabbitMqClient({ url: inject('environment').rabbitUrl, exchange }); clients.push(client);
    const queue = `tc.${randomUUID()}.idempotent`; let deliveries = 0; let effects = 0;
    await client.consume({ queue, routingKeys: ['test.idempotent.v1'] }, async (event) => {
      const connection = await database.connect();
      try {
        await connection.query('BEGIN');
        const claimed = await connection.query('INSERT INTO processed_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [event.id, event.type]);
        if (claimed.rowCount === 1) effects++;
        await connection.query('COMMIT'); deliveries++;
      } catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
    });
    const event = createEventEnvelope('test.idempotent.v1', 'integration-test', {});
    await client.publish(event); await client.publish(event);
    await eventually(async () => deliveries, (value) => value === 2);
    expect(effects).toBe(1);
    expect((await database.query<{ count: string }>('SELECT count(*) FROM processed_events WHERE event_id=$1', [event.id])).rows[0]?.count).toBe('1');
  });
});
