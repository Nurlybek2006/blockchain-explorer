import { Module } from '@nestjs/common';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PortfolioInitialSyncDispatcher } from './portfolio-initial-sync.dispatcher.js';
import { PortfoliosController } from './portfolios.controller.js';
import { PortfoliosRepository } from './portfolios.repository.js';
import { PortfoliosService } from './portfolios.service.js';

@Module({
  imports: [JobsModule],
  controllers: [PortfoliosController],
  providers: [InternalServiceGuard, PortfoliosRepository, PortfoliosService, PortfolioInitialSyncDispatcher],
})
export class PortfoliosModule {}
