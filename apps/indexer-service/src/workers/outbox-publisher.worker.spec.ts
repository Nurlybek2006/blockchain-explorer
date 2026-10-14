import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createEventEnvelope } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../database/database.service.js';
import { RabbitMqPublisherService } from '../modules/messaging/rabbitmq-publisher.service.js';
import { OutboxPublisherWorker } from './outbox-publisher.worker.js';

interface StoredEvent {
  id: string; eventType: string; payload: unknown; status: string;
  attempts: number; availableAt: Date; publishedAt: Date | null; createdAt: Date;
}
interface DriverResult { rows: unknown[][]; rowCount: number; command: string; oid: number; fields: [] }

const driver = vi.hoisted(() => ({ query: vi.fn<(input: unknown, values?: unknown[]) => Promise<DriverResult>>() }));

// Keep the actual DatabaseService and Drizzle query builders. Replace only the
// PostgreSQL transport; the real Testcontainers suite validates the same SQL.
vi.mock('pg', () => ({ Pool: class {
  totalCount = 0; idleCount = 0; waitingCount = 0;
  on(): this { return this; }
  query(input: unknown, values?: unknown[]): Promise<DriverResult> { return driver.query(input, values); }
  async end(): Promise<void> {}
} }));

describe('outbox publication lifecycle and failure boundaries', () => {
  let database: DatabaseService;
  let publisher: RabbitMqPublisherService;
  let worker: OutboxPublisherWorker;
  let rows: StoredEvent[];
  let competingClaim = false;

  function result(rows: unknown[][] = []): DriverResult { return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] }; }
  function queryText(input: unknown): string {
    if (typeof input === 'string') return input;
    if (typeof input === 'object' && input !== null && 'text' in input && typeof input.text === 'string') return input.text;
    throw new Error('Expected a PostgreSQL query');
  }
  function time(value: unknown): Date { if (typeof value !== 'string') throw new Error('Expected an encoded timestamp'); return new Date(value); }

  beforeEach(() => {
    rows = []; competingClaim = false;
    driver.query.mockReset().mockImplementation(async (input, values = []) => {
      const text = queryText(input);
      if (text.startsWith('select') && text.includes('count(*)')) return result([[rows.length, 0]]);
      if (text.startsWith('select')) {
        return result(rows.filter((row) => row.status === values[0] && row.availableAt <= time(values[1]))
          .slice(0, Number(values[2])).map((row) => [row.id, row.eventType, 'block', '101', row.payload, row.status,
            row.attempts, row.availableAt.toISOString(), row.publishedAt?.toISOString() ?? null, row.createdAt.toISOString()]));
      }
      if (!text.startsWith('update')) throw new Error('Unexpected outbox query');
      if (text.includes('returning')) {
        const row = rows.find((candidate) => candidate.id === values[2] && candidate.status === values[3]);
        if (!row) return result();
        row.status = 'processing'; row.attempts++; row.availableAt = time(values[1]);
        return competingClaim ? result() : result([[row.id]]);
      }
      if (text.includes('"published_at"')) {
        const row = rows.find((candidate) => candidate.id === values[2]);
        if (row) { row.status = 'published'; row.publishedAt = time(values[1]); }
      } else if (text.includes('set "status" = $1, "available_at" = $2')) {
        const row = rows.find((candidate) => candidate.id === values[2]);
        if (row) { row.status = 'pending'; row.availableAt = time(values[1]); }
      } else {
        for (const row of rows) if (row.status === values[1] && row.availableAt <= time(values[2])) row.status = 'pending';
      }
      return result();
    });
    const config = new ConfigService({ EXPLORER_DATABASE_URL: 'postgres://test:test@127.0.0.1:1/unit_only',
      RABBITMQ_URL: 'amqp://test:test@127.0.0.1:1', OUTBOX_POLL_INTERVAL_MS: 10, OUTBOX_MAX_RETRY_DELAY_MS: 100,
      OUTBOX_PROCESSING_TIMEOUT_MS: 1000 });
    database = new DatabaseService(config); publisher = new RabbitMqPublisherService(config);
    worker = new OutboxPublisherWorker(database, publisher, config);
  });
  afterEach(async () => { await worker.onApplicationShutdown(); await publisher.onModuleDestroy(); await database.onModuleDestroy(); vi.restoreAllMocks(); });

  function insert(payload: unknown = createEventEnvelope('block.indexed.v1', 'indexer-service', { blockNumber: '101' }), status = 'pending'): StoredEvent {
    const row = { id: '00000000-0000-4000-8000-000000000001', eventType: 'block.indexed.v1', payload, status,
      attempts: 0, availableAt: new Date(Date.now() - 1000), publishedAt: null, createdAt: new Date() };
    rows.push(row); return row;
  }

  it('marks published only after broker confirmation and shutdown waits for the in-flight confirmation', async () => {
    const row = insert();
    let confirm: () => void = () => { throw new Error('Confirmation was not initialized'); };
    const confirmation = new Promise<void>((resolve) => { confirm = resolve; });
    const publish = vi.spyOn(publisher, 'publish').mockReturnValue(confirmation);
    worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(row.status).toBe('processing'); expect(row.publishedAt).toBeNull();
    let stopped = false;
    const stopping = worker.onApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    confirm(); await stopping;
    expect(row.status).toBe('published'); expect(row.publishedAt).toBeInstanceOf(Date); expect(publish).toHaveBeenCalledWith(row.payload);
  });
  it('keeps a failed publish pending with bounded backoff, then publishes the same durable event on recovery', async () => {
    const row = insert();
    let recover = false;
    const publish = vi.spyOn(publisher, 'publish').mockImplementation(async () => { if (!recover) throw new Error('Broker offline'); });
    worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(row.status).toBe('pending'));
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    expect(row.publishedAt).toBeNull(); expect(row.attempts).toBeGreaterThan(0);
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() - 20);
    recover = true;
    await vi.waitFor(() => expect(row.status).toBe('published'));
    expect(row.attempts).toBeGreaterThanOrEqual(2);
    expect(publish.mock.calls.every(([event]) => event === row.payload)).toBe(true);
  });
  it('invalid persisted envelope remains inspectable and is never falsely published or sent to the broker', async () => {
    const row = insert({ invalid: true }); const publish = vi.spyOn(publisher, 'publish').mockResolvedValue();
    worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(row.attempts).toBeGreaterThan(0));
    await worker.onApplicationShutdown();
    expect(row.status).toBe('pending'); expect(row.publishedAt).toBeNull(); expect(publish).not.toHaveBeenCalled();
  });
  it('recovers an expired processing lease while respecting a claim taken by another publisher', async () => {
    const row = insert(undefined, 'processing'); const publish = vi.spyOn(publisher, 'publish').mockResolvedValue();
    competingClaim = true; worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(row.attempts).toBe(1));
    await worker.onApplicationShutdown();
    expect(row.status).toBe('processing'); expect(row.publishedAt).toBeNull(); expect(publish).not.toHaveBeenCalled();
  });
  it('a failed backlog metrics observation does not interrupt a committed event publication', async () => {
    const row = insert(); const publish = vi.spyOn(publisher, 'publish').mockResolvedValue();
    driver.query.mockRejectedValueOnce(new Error('Metrics query unavailable'));
    worker.onApplicationBootstrap();
    await vi.waitFor(() => expect(row.status).toBe('published'));
    await worker.onApplicationShutdown();
    expect(publish).toHaveBeenCalledOnce(); expect(row.publishedAt).toBeInstanceOf(Date);
  });
});
