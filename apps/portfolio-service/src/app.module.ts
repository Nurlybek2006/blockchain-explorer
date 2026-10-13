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

    HealthModule,
  ],
})
export class AppModule {}
