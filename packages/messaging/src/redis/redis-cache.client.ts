
import {
  createClient,
} from 'redis';

export interface RedisCacheClientOptions {
  url: string;

  prefix?: string;
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
    await this.connect();

    const value =
      await this.client
        .get(
          this.key(
            key,
          ),
        );

    if (!value) {
      return null;
    }

    return JSON.parse(
      value,
    ) as T;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
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
  }

  async delete(
    key: string,
  ): Promise<void> {
    await this.connect();

    await this.client
      .del(
        this.key(
          key,
        ),
      );
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

  /** Bounded SCAN batches restricted to this client's namespace. Never uses KEYS. */
  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix || /[\[\]*?\\]/.test(prefix)) {
      throw new Error('Cache prefix must be a non-empty literal');
    }
    await this.connect();
    const literalNamespace = this.key(prefix).replace(/[\\*?\[\]]/g, '\\$&');
    for await (const keys of this.client.scanIterator({ MATCH: `${literalNamespace}*`, COUNT: 100 })) {
      if (keys.length > 0) await this.client.unlink(keys);
    }
  }

  private key(
    key: string,
  ): string {
    return `${this.prefix}:${key}`;
  }
}
// API Gateway үшін Redis cache abstraction береді.
