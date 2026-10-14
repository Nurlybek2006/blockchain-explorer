import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { EVENT_TYPES, type EventEnvelope } from '@blockchain-explorer/contracts';
import { RabbitMqClient } from '@blockchain-explorer/messaging';
import { CacheService } from '../cache/cache.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { mapRealtimeEvent, RealtimeDeduplicator } from './realtime-event.mapper.js';

@Injectable()
export class RealtimeEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeEventsConsumer.name);
  private readonly dedup = new RealtimeDeduplicator();
  private readonly queue: string;
  private readonly chainId: number;
  private rabbit: RabbitMqClient | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private connecting: Promise<void> | undefined;
  private stopped = false;
  private failures = 0;

  constructor(private readonly config: ConfigService, private readonly cache: CacheService, private readonly gateway: RealtimeGateway) {
    this.queue = `${config.get<string>('REALTIME_EVENTS_QUEUE') ?? 'explorer.realtime'}.${randomUUID()}`;
    this.chainId = Number(config.get('ETHEREUM_CHAIN_ID') ?? config.get('CHAIN_ID') ?? 11155111);
  }

  onModuleInit(): void {
    // Broker outages never prevent the REST application from starting.
    if (this.config.get<string>('REALTIME_ENABLED') === 'false') return;
    this.startConnect();
  }

  async handleEvent(event: EventEnvelope): Promise<void> {
    const mapped = mapRealtimeEvent(event, this.chainId);
    if (!mapped) throw new Error('Invalid public Explorer event');
    if (!this.dedup.accept(mapped.id)) return;
    await this.cache.invalidateExplorer(mapped);
    this.gateway.broadcast(mapped);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.connecting?.catch(() => undefined);
    await this.rabbit?.close().catch(() => undefined);
  }

  private startConnect(): void {
    if (this.stopped || this.connecting) return;
    this.connecting = this.connect().finally(() => { this.connecting = undefined; });
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.startConnect(), delay);
    this.timer.unref();
  }

  private async connect(): Promise<void> {
    if (this.rabbit?.isConnected) { this.schedule(5_000); return; }
    await this.rabbit?.close().catch(() => undefined);
    const url = this.config.get<string>('RABBITMQ_URL');
    if (!url) { this.logger.warn('Realtime broker is not configured'); return; }
    const rabbit = new RabbitMqClient({ url, exchange: this.config.get<string>('RABBITMQ_EXCHANGE') ?? 'blockchain.events', prefetch: 20, connectionTimeoutMs: 5_000 });
    this.rabbit = rabbit;
    try {
      await rabbit.consume({ queue: this.queue, routingKeys: [EVENT_TYPES.BLOCK_INDEXED, EVENT_TYPES.TOKEN_TRANSFER_INDEXED, EVENT_TYPES.CHAIN_REORGANIZED],
        durable: false, exclusive: true, autoDelete: true, deadLetter: false, messageTtlMs: 300_000, maxLength: 10_000, maxMessageBytes: 16_384 }, (event) => this.handleEvent(event));
      if (this.stopped) { await rabbit.close(); return; }
      this.failures = 0;
      this.logger.log('Public Explorer realtime bridge connected');
      this.schedule(5_000);
    } catch {
      await rabbit.close().catch(() => undefined);
      this.failures += 1;
      this.logger.warn('Realtime broker unavailable; reconnect scheduled');
      this.schedule(Math.min(30_000, 1_000 * 2 ** Math.min(this.failures, 5)) + Math.floor(Math.random() * 500));
    }
  }
}
