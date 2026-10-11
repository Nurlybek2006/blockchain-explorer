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
  ChainSyncModule,
} from './modules/chain-sync/chain-sync.module.js';

import {
  HealthModule,
} from './modules/health/health.module.js';

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

    ChainSyncModule,

    HealthModule,
  ],
})
export class AppModule {}
// Indexer application-ға database, blockchain sync және health subsystem-дарын қосады.