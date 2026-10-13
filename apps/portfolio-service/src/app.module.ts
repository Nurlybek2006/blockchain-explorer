import {
  Module,
} from '@nestjs/common';

import {
  ConfigModule,
} from '@nestjs/config';

import {
  DatabaseModule,
} from './database/database.module.js';

import {
  HealthModule,
} from './modules/health/health.module.js';

import { PortfoliosModule } from './modules/portfolios/portfolios.module.js';
import { PricesModule } from './modules/prices/prices.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { WatchlistsModule } from './modules/watchlists/watchlists.module.js';
import { AlertsModule } from './modules/alerts/alerts.module.js';

import {
  MessagingModule,
} from './modules/messaging/messaging.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,

      envFilePath: [
        '../../.env',
        '.env',
      ],
    }),

    DatabaseModule,

    MessagingModule,

    PortfoliosModule,

    PricesModule,
    AnalyticsModule,
    WatchlistsModule,
    AlertsModule,

    HealthModule,
  ],
})
export class AppModule {}
