import {
  Module,
} from '@nestjs/common';

import {
  RpcModule,
} from '../rpc/rpc.module.js';

import {
  PortfolioJobsService,
} from './portfolio-jobs.service.js';

import {
  PortfolioJobsWorker,
} from '../../workers/portfolio-jobs.worker.js';
import { PricesModule } from '../prices/prices.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';

@Module({
  imports: [
    RpcModule,
    PricesModule,
    AnalyticsModule,
    AlertsModule,
  ],

  providers: [
    PortfolioJobsService,

    PortfolioJobsWorker,
  ],

  exports: [
    PortfolioJobsService,
  ],
})
export class JobsModule {}
