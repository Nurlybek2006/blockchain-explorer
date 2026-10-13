import { Module } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { PricesModule } from '../prices/prices.module.js';
import { RpcModule } from '../rpc/rpc.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsRepository } from './alerts.repository.js';
import { AlertsService } from './alerts.service.js';

@Module({
  imports: [PricesModule, RpcModule],
  controllers: [AlertsController],
  providers: [InternalServiceGuard, AlertsRepository, AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
