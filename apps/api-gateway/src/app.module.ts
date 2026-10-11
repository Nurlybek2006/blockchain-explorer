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

    ExplorerModule,

    HealthModule,
  ],
})
export class AppModule {}