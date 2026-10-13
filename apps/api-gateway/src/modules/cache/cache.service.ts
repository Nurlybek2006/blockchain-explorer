import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  RedisCacheClient,
  checkDependency,
} from '@blockchain-explorer/messaging';

@Injectable()
export class CacheService
  implements
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger =
    new Logger(
      CacheService.name,
    );

  private readonly cache:
    RedisCacheClient;

  private ready =
    false;

  constructor(
    config:
      ConfigService,
  ) {
    this.cache =
      new RedisCacheClient({
        url:
          config
            .getOrThrow<string>(
              'REDIS_URL',
            ),

        prefix:
          config.get<string>(
            'CACHE_PREFIX',
          ) ??
          'blockchain-explorer',
      });
  }

  async onModuleInit():
    Promise<void> {
    try {
      if (!await checkDependency(() => this.cache.connect(), 5_000)) {
        throw new Error('Redis cache connection timed out');
      }

      this.ready =
        true;

      this.logger.log(
        'Redis cache connected',
      );
    } catch (
      error
    ) {
      this.ready =
        false;

      this.logger.warn(
        `Redis unavailable, cache disabled: ${
          error instanceof Error
            ? error.message
            : String(
                error,
              )
        }`,
      );
    }
  }

  async remember<T>(
    key: string,

    ttlSeconds:
      number,

    factory:
      () => Promise<T>,
  ): Promise<T> {
    if (
      this.ready
    ) {
      try {
        const cached =
          await this.cache
            .getJson<T>(
              key,
            );

        if (
          cached !==
          null
        ) {
          return cached;
        }
      } catch {
        this.ready =
          false;
      }
    }

    const value =
      await factory();

    if (
      this.ready
    ) {
      try {
        await this.cache
          .setJson(
            key,
            value,
            ttlSeconds,
          );
      } catch {
        this.ready =
          false;
      }
    }

    return value;
  }

  async ping(): Promise<void> {
    await this.cache.ping();
    this.ready = true;
  }

  async onModuleDestroy():
    Promise<void> {
    await this.cache
      .close()
      .catch(
        () =>
          undefined,
      );
  }
}
// Redis жұмыс істесе cache қолданады, ал Redis өшсе API жұмысын тоқтатпай тікелей Indexer-ден data алады.
