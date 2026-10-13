import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisCacheClient } from '@blockchain-explorer/messaging';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { CoinGeckoClient } from './coingecko.client.js';
import { PricesCache, PRICES_REDIS_CLIENT } from './prices.cache.js';
import { PricesController } from './prices.controller.js';
import { PricesRepository } from './prices.repository.js';
import { PricesService } from './prices.service.js';

@Module({
  controllers: [PricesController],
  providers: [
    InternalServiceGuard, CoinGeckoClient, PricesRepository, PricesCache, PricesService,
    {
      provide: PRICES_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new RedisCacheClient({
        url: config.getOrThrow<string>('REDIS_URL'),
        prefix: `${config.get<string>('CACHE_PREFIX') ?? 'blockchain-explorer'}:portfolio`,
      }),
    },
  ],
  exports: [PricesService],
})
export class PricesModule {}
