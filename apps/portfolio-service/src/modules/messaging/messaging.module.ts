import {
  Module,
} from '@nestjs/common';

import {
  JobsModule,
} from '../jobs/jobs.module.js';

import {
  PortfolioEventsConsumer,
} from './portfolio-events.consumer.js';

@Module({
  imports: [
    JobsModule,
  ],

  providers: [
    PortfolioEventsConsumer,
  ],

  exports: [PortfolioEventsConsumer],
})
export class MessagingModule {}
