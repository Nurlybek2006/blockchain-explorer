import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntelligenceClient } from './intelligence.client.js';
import { PricesController } from './prices.controller.js';
import { WatchlistsController } from './watchlists.controller.js';
import { AlertsController } from './alerts.controller.js';

@Module({
  imports: [AuthModule],
  providers: [IntelligenceClient],
  controllers: [PricesController, WatchlistsController, AlertsController],
  exports: [IntelligenceClient],
})
export class IntelligenceModule {}
