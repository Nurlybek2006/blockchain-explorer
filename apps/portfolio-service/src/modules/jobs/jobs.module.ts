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

@Module({
  imports: [
    RpcModule,
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