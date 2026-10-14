import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheClient } from '@blockchain-explorer/messaging';
import type { NextFunction, Request, Response } from 'express';
import { readHttpSecurityConfig, type HttpSecurityConfig } from './http-security.config.js';

export type RateLimitBucket = 'auth' | 'search' | 'expensive';

export function rateLimitBucket(method: string, path: string): RateLimitBucket | null {
  const canonical = path.replace(/\/+$/, '') || '/';
  if (method === 'POST' && /^\/auth\/(login|register|refresh)$/i.test(canonical)) return 'auth';
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (/^\/search$/i.test(canonical)) return 'search';
  if (/^\/contract\/[^/]+$/i.test(canonical) || /^\/tx\/[^/]+\/traces$/i.test(canonical)
    || /^\/address\/[^/]+$/i.test(canonical) || /^\/token\/[^/]+$/i.test(canonical)) return 'expensive';
  return null;
}

@Injectable()
export class SecurityRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityRateLimitService.name);
  private readonly settings: HttpSecurityConfig;
  private readonly redis: RedisCacheClient;
  private ready = false;
  private connecting: Promise<void> | undefined;
  private retryAt = 0;

  constructor(config: ConfigService) {
    this.settings = readHttpSecurityConfig(config);
    this.redis = new RedisCacheClient({
      url: config.getOrThrow<string>('REDIS_URL'),
      prefix: `${config.get<string>('CACHE_PREFIX') ?? 'blockchain-explorer'}:rate-limit`,
      connectTimeoutMs: this.settings.redisTimeoutMs, disableOfflineQueue: true, reconnect: false,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.settings.rateLimitEnabled) return;
    try { await this.deadline(this.ensureReady()); }
    catch {
      this.redis.disconnect();
      this.retryAt = Date.now() + 1_000;
      this.logger.warn('Rate limiter unavailable; auth requests fail closed, public reads fail open');
    }
  }

  async handle(request: Request, response: Response, next: NextFunction): Promise<void> {
    const bucket = rateLimitBucket(request.method, request.path);
    if (!this.settings.rateLimitEnabled || bucket === null) { next(); return; }
    const limit = bucket === 'auth' ? this.settings.rateLimitAuthMax : bucket === 'search'
      ? this.settings.rateLimitSearchMax : this.settings.rateLimitExpensiveMax;
    // Express honors only explicitly trusted peers. X-Forwarded-For is never read directly.
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const identity = createHash('sha256').update(ip).digest('hex');
    try {
      const result = await this.deadline((async () => {
        await this.ensureReady();
        return this.redis.consumeFixedWindow(`${bucket}:${identity}`, limit, this.settings.rateLimitWindowMs);
      })());
      response.setHeader('RateLimit-Limit', String(limit));
      response.setHeader('RateLimit-Remaining', String(result.remaining));
      response.setHeader('RateLimit-Reset', String(Math.ceil(result.retryAfterMs / 1_000)));
      if (!result.allowed) {
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))));
        response.status(429).json({ statusCode: 429, message: 'Too many requests', error: 'Too Many Requests' });
        return;
      }
    } catch {
      this.redis.disconnect();
      this.ready = false;
      this.retryAt = Date.now() + 1_000;
      if (bucket === 'auth') {
        response.setHeader('Retry-After', '1');
        response.status(503).json({ statusCode: 503, message: 'Authentication temporarily unavailable', error: 'Service Unavailable' });
        return;
      }
    }
    next();
  }

  onModuleDestroy(): void { this.redis.disconnect(); }

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (Date.now() < this.retryAt) throw new Error('Rate limiter reconnect cooldown');
    if (!this.connecting) {
      this.connecting = this.redis.ping().then(() => { this.ready = true; this.retryAt = 0; })
        .finally(() => { this.connecting = undefined; });
    }
    await this.connecting;
  }

  private async deadline<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Rate limiter deadline exceeded')), this.settings.redisTimeoutMs);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
}
