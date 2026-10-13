import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';

@Module({
  imports: [JobsModule, MessagingModule],
  controllers: [HealthController],
})
export class HealthModule {}
