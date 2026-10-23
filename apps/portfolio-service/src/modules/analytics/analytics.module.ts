import { Module } from '@nestjs/common';
import { PricesModule } from '../prices/prices.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsRepository, DrizzleAnalyticsRepository } from './analytics.repository.js';
import { AnalyticsService } from './analytics.service.js';
import { PnlController } from './pnl.controller.js';
import { PnlService } from './pnl.service.js';
import { TradesRepository } from './trades.repository.js';

@Module({
  imports: [PricesModule],
  controllers: [AnalyticsController, PnlController],
  providers: [{ provide: AnalyticsRepository, useClass: DrizzleAnalyticsRepository }, AnalyticsService, PnlService, TradesRepository],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
