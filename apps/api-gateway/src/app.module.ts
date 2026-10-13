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

import {
  ExplorerModule,
} from './modules/explorer/explorer.module.js';

import {
  CacheModule,
} from './modules/cache/cache.module.js';

import { AuthModule } from './modules/auth/auth.module.js';
import { PortfolioModule } from './modules/portfolio/portfolio.module.js';
import { IntelligenceModule } from './modules/intelligence/intelligence.module.js';

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

    CacheModule,

    AuthModule,

    PortfolioModule,
    IntelligenceModule,

    ExplorerModule,

    HealthModule,
  ],
})
export class AppModule {}
