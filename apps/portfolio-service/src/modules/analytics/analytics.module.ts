import { Module } from '@nestjs/common';
import { PricesModule } from '../prices/prices.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository, DrizzleAnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';

@Module({
  imports: [PricesModule],
  controllers: [AnalyticsController],
  providers: [{ provide: AnalyticsRepository, useClass: DrizzleAnalyticsRepository }, AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
