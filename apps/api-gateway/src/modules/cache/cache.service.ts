import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheClient, checkDependency } from '@blockchain-explorer/messaging';
import type { RealtimeExplorerEvent } from '@blockchain-explorer/contracts';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache: RedisCacheClient;
  private ready = false;
  private generation = 0;
  private dirtyExplorer = false;

  constructor(config: ConfigService) {
    this.cache = new RedisCacheClient({
      url: config.getOrThrow<string>('REDIS_URL'),
      prefix: config.get<string>('CACHE_PREFIX') ?? 'blockchain-explorer',
    });
  }

  async onModuleInit(): Promise<void> {
    this.ready = await checkDependency(() => this.cache.connect(), 750);
    if (this.ready) this.logger.log('Redis cache connected');
    else this.logger.warn('Redis unavailable; requests use the upstream service');
  }

  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>, decode?: (value: unknown) => T): Promise<T> {
    const generation = this.generation;
    if (this.ready && decode) {
      try {
        const cached = await this.deadline(this.cache.getJson<unknown>(key));
        if (cached !== null && generation === this.generation) return decode(cached);
      } catch { this.ready = false; }
    } else if (this.ready) {
      try {
        const cached = await this.deadline(this.cache.getJson<T>(key));
        if (cached !== null && generation === this.generation) return cached;
      } catch { this.ready = false; }
    }
    const writeGeneration = this.generation;
    const value = await factory();
    if (this.ready && writeGeneration === this.generation) {
      try { await this.deadline(this.cache.setJson(key, value, ttlSeconds)); }
      catch { this.ready = false; }
    }
    return value;
  }

  async invalidateExplorer(event: RealtimeExplorerEvent): Promise<void> {
    this.generation += 1;
    if (!this.ready) { this.dirtyExplorer = true; return; }
    const prefixes = event.type === 'chain.reorganized' ? ['explorer:']
      : event.type === 'block.indexed' ? ['explorer:blocks:1:']
      : [`explorer:token:${event.payload.tokenAddress}:`, `explorer:address:${event.payload.fromAddress}:`, `explorer:address:${event.payload.toAddress}:`];
    try {
      await this.deadline(Promise.all([
        this.cache.delete('explorer:stats'),
        this.cache.delete('explorer:network-status'),
        ...prefixes.map((prefix) => this.cache.deletePrefix(prefix)),
      ]));
    } catch {
      this.ready = false;
      this.dirtyExplorer = true;
      this.logger.warn('Explorer cache invalidation unavailable; cache bypass enabled');
    }
  }

  async ping(): Promise<void> {
    await this.deadline(this.cache.ping());
    const generation = this.generation;
    if (this.dirtyExplorer) await this.deadline(this.cache.deletePrefix('explorer:'));
    if (generation === this.generation) { this.dirtyExplorer = false; this.ready = true; }
  }
  async onModuleDestroy(): Promise<void> { await this.cache.close().catch(() => undefined); }

  private async deadline<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Cache deadline exceeded')), 750);
      })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
}
