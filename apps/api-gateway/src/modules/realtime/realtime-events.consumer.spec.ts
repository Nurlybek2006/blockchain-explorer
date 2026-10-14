import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EVENT_TYPES, type EventEnvelope } from '@blockchain-explorer/contracts';
const broker = vi.hoisted(() => ({ consume: vi.fn(), close: vi.fn(), connected: false }));
vi.mock('@blockchain-explorer/messaging', () => ({ RedisCacheClient: class {}, RabbitMqClient: class { consume = broker.consume; close = broker.close; get isConnected() { return broker.connected; } } }));
import { CacheService } from '../cache/cache.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeEventsConsumer } from './realtime-events.consumer.js';

class MemoryCache extends CacheService {
  events: string[] = [];
  constructor() { super(new ConfigService({ REDIS_URL: 'redis://unit-test' })); }
  override async invalidateExplorer(event: { id: string }): Promise<void> { this.events.push(event.id); }
}
class MemoryGateway extends RealtimeGateway {
  events: string[] = [];
  constructor() { super(new ConfigService()); }
  override broadcast(event: { id: string }): void { this.events.push(event.id); }
}
const blockEvent: EventEnvelope = { id: 'block-test', type: EVENT_TYPES.BLOCK_INDEXED, version: 1, producer: 'indexer', occurredAt: '2026-10-14T00:00:00.000Z', payload: { chainId: 11155111, networkName: 'sepolia', blockNumber: '42', blockHash: `0x${'a'.repeat(64)}`, parentHash: `0x${'b'.repeat(64)}`, timestamp: '2026-10-14T00:00:00.000Z', transactionCount: 0, logCount: 0, tokenTransferCount: 0 } };
beforeEach(() => { vi.clearAllMocks(); broker.connected = false; broker.consume.mockResolvedValue(undefined); broker.close.mockResolvedValue(undefined); });

describe('RabbitMQ public realtime failure isolation', () => {
  it('validates once, suppresses delivery replays and invalidates cache before broadcast', async () => {
    const cache = new MemoryCache(); const gateway = new MemoryGateway(); const consumer = new RealtimeEventsConsumer(new ConfigService({ CHAIN_ID: 11155111 }), cache, gateway);
    await consumer.handleEvent(blockEvent); await consumer.handleEvent(blockEvent);
    expect(cache.events).toEqual(['block-test']); expect(gateway.events).toEqual(['block-test']);
    await expect(consumer.handleEvent({ ...blockEvent, payload: { userId: 'private' } })).rejects.toThrow('Invalid public Explorer event');
    expect(gateway.events).toHaveLength(1);
  });
  it('creates a separate ephemeral subscription for each Gateway replica', async () => {
    const config = new ConfigService({ RABBITMQ_URL: 'amqp://test', REALTIME_EVENTS_QUEUE: 'test-realtime' });
    const one = new RealtimeEventsConsumer(config, new MemoryCache(), new MemoryGateway());
    const two = new RealtimeEventsConsumer(config, new MemoryCache(), new MemoryGateway());
    expect(one.onModuleInit()).toBeUndefined(); expect(two.onModuleInit()).toBeUndefined();
    await vi.waitFor(() => expect(broker.consume).toHaveBeenCalledTimes(2));
    const a = broker.consume.mock.calls[0]?.[0]; const b = broker.consume.mock.calls[1]?.[0];
    expect(a).toMatchObject({ durable: false, exclusive: true, autoDelete: true, deadLetter: false, maxLength: 10_000, maxMessageBytes: 16_384 });
    expect(a.queue).not.toBe(b.queue);
    await one.onModuleDestroy(); await two.onModuleDestroy();
  });
  it('does not await an unavailable broker during REST startup and retries later', async () => {
    vi.useFakeTimers(); broker.consume.mockRejectedValue(new Error('secret-connection-string'));
    const consumer = new RealtimeEventsConsumer(new ConfigService({ RABBITMQ_URL: 'amqp://test' }), new MemoryCache(), new MemoryGateway());
    expect(consumer.onModuleInit()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000); expect(broker.consume.mock.calls.length).toBeGreaterThanOrEqual(2);
    await consumer.onModuleDestroy(); const attempts = broker.consume.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000); expect(broker.consume).toHaveBeenCalledTimes(attempts); vi.useRealTimers();
  });
  it('honors disabled realtime in isolated verification environments', async () => {
    const consumer = new RealtimeEventsConsumer(new ConfigService({ REALTIME_ENABLED: 'false' }), new MemoryCache(), new MemoryGateway());
    consumer.onModuleInit(); expect(broker.consume).not.toHaveBeenCalled(); await consumer.onModuleDestroy();
  });
});
