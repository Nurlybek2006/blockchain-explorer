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
  JobsModule,
} from './modules/jobs/jobs.module.js';

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

    HealthModule,
  ],
})
export class AppModule {}