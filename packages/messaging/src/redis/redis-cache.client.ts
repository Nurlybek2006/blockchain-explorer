
import {
  createClient,
} from 'redis';
import { recordCounter, recordHistogram, SpanKind, withSpan } from '@blockchain-explorer/observability';
import { cacheMetricNamespace } from '../telemetry.js';

export interface RedisCacheClientOptions {
  url: string;

  prefix?: string;
  connectTimeoutMs?: number;
  disableOfflineQueue?: boolean;
  reconnect?: boolean;
}

export class RedisCacheClient {
  private readonly client:
    ReturnType<
      typeof createClient
    >;

  private readonly prefix:
    string;

  constructor(
    options:
      RedisCacheClientOptions,
  ) {
    this.prefix =
      options.prefix ??
      'blockchain-explorer';

    this.client =
      createClient({
        url:
          options.url,
        disableOfflineQueue: options.disableOfflineQueue ?? false,
        socket: {
          connectTimeout: options.connectTimeoutMs ?? 5_000,
          ...(options.reconnect === false ? { reconnectStrategy: false } : {}),
        },
      });

    // Requests surface connection failures to the service's cache fallback.
    this.client.on('error', () => undefined);
  }

  async connect():
    Promise<void> {
    if (
      this.client.isOpen
    ) {
      return;
    }

    await this.client
      .connect();
  }

  async ping():
    Promise<string> {
    await this.connect();

    return this.client
      .ping();
  }

  async getJson<T>(
    key: string,
  ): Promise<T | null> {
    return this.measure('get', key, async () => {
    await this.connect();

    const value =
      await this.client
        .get(
          this.key(
            key,
          ),
        );

    if (!value) {
      recordCounter('cache_misses_total', 1, { namespace: cacheMetricNamespace(key) });
      return null;
    }

    const parsed = JSON.parse(
      value,
    ) as T;
    recordCounter('cache_hits_total', 1, { namespace: cacheMetricNamespace(key) });
    return parsed;
    });
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.measure('set', key, async () => {
    await this.connect();

    await this.client
      .set(
        this.key(
          key,
        ),

        JSON.stringify(
          value,
        ),

        {
          EX:
            ttlSeconds,
        },
      );
    });
  }

  async delete(
    key: string,
  ): Promise<void> {
    await this.measure('delete', key, async () => {
    await this.connect();

    await this.client
      .del(
        this.key(
          key,
        ),
      );
    });
  }

  async close():
    Promise<void> {
    if (
      this.client.isOpen
    ) {
      if (!this.client.isReady) {
        this.client.destroy();
        return;
      }
      await this.client
        .quit();
    }
  }

  /** Abort an optional client when a caller's deadline expires. */
  disconnect(): void { if (this.client.isOpen) this.client.destroy(); }

  /** Bounded SCAN batches restricted to this client's namespace. Never uses KEYS. */
  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix || /[\[\]*?\\]/.test(prefix)) {
      throw new Error('Cache prefix must be a non-empty literal');
    }
    await this.measure('delete_prefix', prefix, async () => {
    await this.connect();
    const literalNamespace = this.key(prefix).replace(/[\\*?\[\]]/g, '\\$&');
    for await (const keys of this.client.scanIterator({ MATCH: `${literalNamespace}*`, COUNT: 100 })) {
      if (keys.length > 0) await this.client.unlink(keys);
    }
    });
  }

  /** Atomic fixed windows retain only a bounded, expiring hashed identity key. */
  async consumeFixedWindow(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
    if (!key || key.length > 256 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000
      || !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000) {
      throw new Error('Invalid rate limit configuration');
    }
    await this.connect();
    const result: unknown = await this.client.eval(
      'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("PEXPIRE",KEYS[1],ARGV[1]); end; local t=redis.call("PTTL",KEYS[1]); if t<0 then redis.call("PEXPIRE",KEYS[1],ARGV[1]); t=tonumber(ARGV[1]); end; return {n,t}',
      { keys: [this.key(key)], arguments: [String(windowMs)] },
    );
    if (!Array.isArray(result) || result.length !== 2 || typeof result[0] !== 'number' || typeof result[1] !== 'number'
      || !Number.isSafeInteger(result[0]) || !Number.isSafeInteger(result[1]) || result[0] < 1 || result[1] < 0) {
      throw new Error('Invalid Redis rate limit response');
    }
    return { allowed: result[0] <= limit, remaining: Math.max(0, limit - result[0]), retryAfterMs: result[0] > limit ? result[1] : 0 };
  }

  private async measure<T>(operation: 'get' | 'set' | 'delete' | 'delete_prefix', key: string, work: () => Promise<T>): Promise<T> {
    const attributes = { namespace: cacheMetricNamespace(key), operation };
    recordCounter('cache_requests_total', 1, attributes);
    return withSpan('redis.cache', { 'db.system.name': 'redis', 'db.operation.name': operation, 'cache.namespace': attributes.namespace }, async () => {
      const started = performance.now();
      try { return await work(); }
      catch (error) { recordCounter('cache_errors_total', 1, attributes); throw error; }
      finally { recordHistogram('cache_operation_duration_seconds', (performance.now() - started) / 1_000, attributes); }
    }, { kind: SpanKind.CLIENT });
  }

  private key(
    key: string,
  ): string {
    return `${this.prefix}:${key}`;
  }
}
// API Gateway үшін Redis cache abstraction береді.
