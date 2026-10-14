import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSDK } from '../../../../../packages/observability/node_modules/@opentelemetry/sdk-node/build/src/index.js';
import { InMemorySpanExporter, SimpleSpanProcessor } from '../../../../../packages/observability/node_modules/@opentelemetry/sdk-trace-base/build/src/index-shim.js';
import * as telemetry from '@blockchain-explorer/observability';
import { EthereumRpcClient } from '../../../../../packages/blockchain-client/dist/index.js';
import { BullMqFactory, RabbitMqClient, RedisCacheClient } from '@blockchain-explorer/messaging';
import { createEventEnvelope } from '@blockchain-explorer/contracts';

interface FakeJob {
  name: string;
  data: { value: number };
  attemptsMade: number;
  opts: { telemetry?: { metadata?: string; omitContext?: boolean } };
}
interface Delivery { content: Buffer; properties: { headers: Record<string, string> } }
type JobProcessor = (job: FakeJob, token?: string) => Promise<unknown>;

const doubles = vi.hoisted(() => {
  const redis = {
    isOpen: false, isReady: true,
    on: vi.fn(), connect: vi.fn(async () => { redis.isOpen = true; }),
    get: vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
    quit: vi.fn(async () => { redis.isOpen = false; }), destroy: vi.fn(),
  };
  const confirmations: Array<(error: Error | null) => void> = [];
  const deliveries: Array<(message: Delivery | null) => Promise<void>> = [];
  const channel = {
    on: vi.fn(), assertExchange: vi.fn().mockResolvedValue({}), prefetch: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue({}), bindQueue: vi.fn().mockResolvedValue({}),
    publish: vi.fn((_exchange: string, _routingKey: string, _body: Buffer, _options: unknown, confirm: (error: Error | null) => void) => { confirmations.push(confirm); return true; }),
    consume: vi.fn(async (_queue: string, handler: (message: Delivery | null) => Promise<void>) => { deliveries.push(handler); return { consumerTag: 'fixture' }; }),
    ack: vi.fn(), nack: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
  };
  const connection = { on: vi.fn(), createConfirmChannel: vi.fn().mockResolvedValue(channel), close: vi.fn().mockResolvedValue(undefined) };
  const workers: FakeWorker[] = [];
  const queues: FakeQueue[] = [];
  class FakeWorker {
    private readonly listeners = new Map<string, Array<(job: FakeJob | undefined, error?: Error) => void>>();
    constructor(readonly name: string, readonly processor: JobProcessor) { workers.push(this); }
    on(event: string, listener: (job: FakeJob | undefined, error?: Error) => void): this {
      const listeners = this.listeners.get(event) ?? []; listeners.push(listener); this.listeners.set(event, listeners); return this;
    }
    emit(event: string, job: FakeJob | undefined, error?: Error): void { for (const listener of this.listeners.get(event) ?? []) listener(job, error); }
    async close(): Promise<void> {}
  }
  class FakeQueue {
    readonly jobs: FakeJob[] = [];
    readonly add = vi.fn(async (name: string, data: { value: number }, opts: FakeJob['opts'] = {}): Promise<FakeJob> => {
      const job = { name, data, opts, attemptsMade: 0 }; this.jobs.push(job); return job;
    });
    readonly getJobCounts = vi.fn(async () => ({ active: 1, waiting: 2 }));
    constructor(readonly name: string) { queues.push(this); }
    async close(): Promise<void> {}
  }
  return { redis, channel, connection, confirmations, deliveries, workers, queues, FakeWorker, FakeQueue };
});

vi.mock('../../../../../packages/messaging/node_modules/redis', () => ({ createClient: () => doubles.redis }));
vi.mock('../../../../../packages/messaging/node_modules/amqplib', () => ({ default: { connect: async () => doubles.connection } }));
vi.mock('../../../../../packages/messaging/node_modules/bullmq', () => ({ Queue: doubles.FakeQueue, Worker: doubles.FakeWorker }));
vi.mock('@blockchain-explorer/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blockchain-explorer/observability')>();
  return { ...actual, recordCounter: vi.fn(), recordHistogram: vi.fn(), recordGauge: vi.fn() };
});

const exporter = new InMemorySpanExporter();
const sdk = new NodeSDK({ autoDetectResources: false, spanProcessors: [new SimpleSpanProcessor(exporter)], metricReaders: [], logRecordProcessors: [], instrumentations: [] });
beforeAll(() => { sdk.start(); });
beforeEach(() => {
  vi.clearAllMocks(); exporter.reset(); doubles.redis.isOpen = false;
  doubles.confirmations.length = 0; doubles.deliveries.length = 0; doubles.workers.length = 0; doubles.queues.length = 0;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await sdk.shutdown(); });

describe('shared Ethereum RPC telemetry', () => {
  it('counts a real 429 attempt, retry, rate limit and successful duration without URL labels', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('{"jsonrpc":"2.0","id":2,"result":"0x2a"}'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new EthereumRpcClient({ url: 'https://rpc.invalid/fixture', maxRetries: 1, retryBaseDelayMs: 1, requestsPerSecond: 20 });
    try {
      const result = client.getBlockNumber(); await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toBe(42n); expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'ethereum_rpc_requests_total')).toHaveLength(2);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('ethereum_rpc_errors_total', 1, { method: 'eth_blockNumber' });
      expect(telemetry.recordCounter).toHaveBeenCalledWith('ethereum_rpc_retries_total', 1, { method: 'eth_blockNumber' });
      expect(telemetry.recordCounter).toHaveBeenCalledWith('ethereum_rpc_rate_limited_total', 1, { method: 'eth_blockNumber' });
      expect(vi.mocked(telemetry.recordHistogram).mock.calls.filter(([name]) => name === 'ethereum_rpc_duration_seconds')).toHaveLength(2);
      const spans = exporter.getFinishedSpans().filter((span) => span.name === 'ethereum.rpc');
      expect(spans.map((span) => span.attributes['retry.attempt'])).toEqual([0, 1]);
      expect(spans[0]?.status.code).toBe(telemetry.SpanStatusCode.ERROR);
      expect(spans[1]?.attributes['rpc.status']).toBe('success');
      expect(JSON.stringify(vi.mocked(telemetry.recordCounter).mock.calls)).not.toContain('rpc.invalid');
    } finally { client.close(); }
  });

  it('preserves exhausted request failures, recording ERROR and collapsing unknown methods', async () => {
    const failure = new TypeError('RPC offline'); vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(failure));
    const client = new EthereumRpcClient({ url: 'https://rpc.invalid', maxRetries: 0 });
    try {
      await expect(client.request('unbounded-user-input')).rejects.toBe(failure);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('ethereum_rpc_errors_total', 1, { method: 'other' });
      const span = exporter.getFinishedSpans().find((candidate) => candidate.name === 'ethereum.rpc');
      expect(span?.status.code).toBe(telemetry.SpanStatusCode.ERROR); expect(span?.events[0]?.name).toBe('exception');
    } finally { client.close(); }
  });
});

describe('shared Redis operational telemetry', () => {
  it('measures cache hit, miss and failure independently without exposing keys', async () => {
    doubles.redis.get.mockResolvedValueOnce('{"value":42}').mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Redis unavailable'));
    const cache = new RedisCacheClient({ url: 'redis://127.0.0.1:1', prefix: 'fixture' });
    try {
      expect(await cache.getJson('price:native:eth')).toEqual({ value: 42 });
      expect(await cache.getJson('portfolio:private-id')).toBeNull();
      await expect(cache.getJson('tx:private-hash')).rejects.toThrow('Redis unavailable');
      expect(telemetry.recordCounter).toHaveBeenCalledWith('cache_hits_total', 1, { namespace: 'price' });
      expect(telemetry.recordCounter).toHaveBeenCalledWith('cache_misses_total', 1, { namespace: 'portfolio' });
      expect(telemetry.recordCounter).toHaveBeenCalledWith('cache_errors_total', 1, { namespace: 'explorer', operation: 'get' });
      expect(vi.mocked(telemetry.recordCounter).mock.calls.filter(([name]) => name === 'cache_requests_total')).toHaveLength(3);
      expect(vi.mocked(telemetry.recordHistogram).mock.calls.filter(([name]) => name === 'cache_operation_duration_seconds')).toHaveLength(3);
      expect(JSON.stringify(vi.mocked(telemetry.recordCounter).mock.calls)).not.toContain('private-');
    } finally { await cache.close(); }
  });

  it('counts invalid stored JSON as an operational error rather than a cache hit', async () => {
    doubles.redis.get.mockResolvedValueOnce('invalid-json');
    const cache = new RedisCacheClient({ url: 'redis://127.0.0.1:1' });
    try {
      await expect(cache.getJson('stats')).rejects.toBeInstanceOf(SyntaxError);
      expect(vi.mocked(telemetry.recordCounter).mock.calls.some(([name]) => name === 'cache_hits_total')).toBe(false);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('cache_errors_total', 1, { namespace: 'explorer', operation: 'get' });
    } finally { await cache.close(); }
  });
});

describe('shared RabbitMQ confirm and context telemetry', () => {
  it('counts publish success only after confirmation and emits one error on broker rejection', async () => {
    const client = new RabbitMqClient({ url: 'amqp://127.0.0.1:1' });
    const event = createEventEnvelope('block.indexed.v1', 'fixture', { blockNumber: '42' });
    try {
      const publishing = telemetry.withRequestId('rabbit-request', () => client.publish(event));
      await vi.waitFor(() => expect(doubles.confirmations).toHaveLength(1));
      expect(vi.mocked(telemetry.recordCounter).mock.calls.some(([name]) => name === 'rabbitmq_published_total')).toBe(false);
      expect(doubles.channel.publish.mock.calls[0]?.[3]).toMatchObject({ headers: { 'x-request-id': 'rabbit-request', traceparent: expect.any(String) } });
      doubles.confirmations[0]?.(null); await publishing;
      expect(telemetry.recordCounter).toHaveBeenCalledWith('rabbitmq_published_total', 1, { event_type: 'block.indexed.v1' });
      const failure = new Error('Broker rejected confirm');
      const rejected = expect(client.publish(event)).rejects.toBe(failure);
      await vi.waitFor(() => expect(doubles.confirmations).toHaveLength(2)); doubles.confirmations[1]?.(failure); await rejected;
      expect(telemetry.recordCounter).toHaveBeenCalledWith('rabbitmq_publish_errors_total', 1, { event_type: 'block.indexed.v1' });
      expect(exporter.getFinishedSpans().find((span) => span.name === 'rabbitmq.publish' && span.status.code === telemetry.SpanStatusCode.ERROR)).toBeDefined();
    } finally { await client.close(); }
  });

  it('extracts delivery trace/request context and acknowledges only successful processing', async () => {
    const client = new RabbitMqClient({ url: 'amqp://127.0.0.1:1' });
    const event = createEventEnvelope('token.transfer.indexed.v1', 'fixture', {});
    const parent = '1'.repeat(32); const parentSpan = '2'.repeat(16);
    const handler = vi.fn(async () => { expect(telemetry.currentRequestId()).toBe('delivery-request'); });
    try {
      await client.consume({ queue: 'fixture', routingKeys: ['#'], deadLetter: false }, handler);
      const deliver = doubles.deliveries[0]; if (!deliver) throw new Error('Missing delivery callback');
      const message = { content: Buffer.from(JSON.stringify(event)), properties: { headers: { traceparent: `00-${parent}-${parentSpan}-01`, 'x-request-id': 'delivery-request' } } };
      await deliver(message);
      expect(handler).toHaveBeenCalledWith(event); expect(doubles.channel.ack).toHaveBeenCalledWith(message);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('rabbitmq_consumed_total', 1, { event_type: 'token.transfer.indexed.v1' });
      const span = exporter.getFinishedSpans().find((candidate) => candidate.name === 'rabbitmq.consume');
      expect(span?.spanContext().traceId).toBe(parent); expect(span?.parentSpanContext?.spanId).toBe(parentSpan);
      handler.mockRejectedValueOnce(new Error('Consumer rejected event')); await deliver(message);
      expect(doubles.channel.ack).toHaveBeenCalledTimes(1); expect(doubles.channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('rabbitmq_consumer_errors_total', 1, { event_type: 'token.transfer.indexed.v1' });
    } finally { await client.close(); }
  });
});

describe('shared BullMQ factory processor telemetry', () => {
  it('stores context in options, preserves job data, and restores the enqueue parent in the processor', async () => {
    const factory = new BullMqFactory({ redisUrl: 'redis://127.0.0.1:1' });
    const queue = factory.createQueue<{ value: number }, number, 'sync-token-holding'>('portfolio-jobs');
    const processor = vi.fn(async (job: { data: { value: number } }) => { expect(telemetry.currentRequestId()).toBe('bull-request'); return job.data.value * 2; });
    const worker = factory.createWorker<{ value: number }, number, 'sync-token-holding'>('portfolio-jobs', processor);
    try {
      const job = await telemetry.withRequestId('bull-request', () => queue.add('sync-token-holding', { value: 21 }));
      const driver = doubles.workers[0]; if (!driver) throw new Error('Missing processor driver');
      const input = doubles.queues[0]?.jobs[0]; if (!input) throw new Error('Missing queued fixture');
      expect(input.data).toEqual({ value: 21 }); expect(input.opts.telemetry?.metadata).toContain('traceparent');
      expect(await driver.processor(input)).toBe(42); driver.emit('completed', input);
      expect(job.data).toEqual({ value: 21 });
      expect(telemetry.recordCounter).toHaveBeenCalledWith('bullmq_jobs_completed_total', 1, { queue: 'portfolio-jobs', job_name: 'sync-token-holding' });
      expect(telemetry.recordHistogram).toHaveBeenCalledWith('bullmq_job_duration_seconds', expect.any(Number), { queue: 'portfolio-jobs', job_name: 'sync-token-holding' });
      const producer = exporter.getFinishedSpans().find((span) => span.name === 'bullmq.enqueue');
      const consumer = exporter.getFinishedSpans().find((span) => span.name === 'bullmq.job');
      expect(consumer?.spanContext().traceId).toBe(producer?.spanContext().traceId);
      expect(consumer?.parentSpanContext?.spanId).toBe(producer?.spanContext().spanId);
    } finally { await worker.close(); await queue.close(); }
  });

  it('preserves processor failures, records duration/ERROR, and counts real failed events', async () => {
    const failure = new Error('Portfolio processor failed');
    const factory = new BullMqFactory({ redisUrl: 'redis://127.0.0.1:1' });
    const worker = factory.createWorker<{ value: number }, never, 'rebuild-portfolio'>('portfolio-jobs', async () => { throw failure; });
    try {
      const driver = doubles.workers[0]; if (!driver) throw new Error('Missing processor driver');
      const input: FakeJob = { name: 'rebuild-portfolio', data: { value: 0 }, opts: {}, attemptsMade: 1 };
      await expect(driver.processor(input)).rejects.toBe(failure); driver.emit('failed', input, failure);
      expect(telemetry.recordCounter).toHaveBeenCalledWith('bullmq_jobs_failed_total', 1, { queue: 'portfolio-jobs', job_name: 'rebuild-portfolio' });
      expect(vi.mocked(telemetry.recordCounter).mock.calls.some(([name]) => name === 'bullmq_jobs_completed_total')).toBe(false);
      expect(telemetry.recordHistogram).toHaveBeenCalledWith('bullmq_job_duration_seconds', expect.any(Number), { queue: 'portfolio-jobs', job_name: 'rebuild-portfolio' });
      expect(exporter.getFinishedSpans().find((span) => span.name === 'bullmq.job')?.status.code).toBe(telemetry.SpanStatusCode.ERROR);
    } finally { await worker.close(); }
  });
});
