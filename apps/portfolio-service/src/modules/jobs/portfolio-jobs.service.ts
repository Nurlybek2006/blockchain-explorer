import {
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  BullMqFactory,
  type Queue,
} from '@blockchain-explorer/messaging';

import {
  PORTFOLIO_JOB_NAMES,
  type PortfolioJobData,
  type PortfolioJobName,
  type RebuildPortfolioJob,
  type SyncTokenHoldingJob,
} from './portfolio-job.types.js';

@Injectable()
export class PortfolioJobsService
  implements OnModuleDestroy
{
  readonly queue:
    Queue<
      PortfolioJobData,
      void,
      PortfolioJobName
    >;

  constructor(
    config:
      ConfigService,
  ) {
    const factory =
      new BullMqFactory({
        redisUrl:
          config
            .getOrThrow<string>(
              'REDIS_URL',
            ),
      });

    const queueName =
      config.get<string>(
        'PORTFOLIO_QUEUE_NAME',
      ) ??
      'portfolio-jobs';

    this.queue =
      factory
        .createQueue<
          PortfolioJobData,
          void,
          PortfolioJobName
        >(
          queueName,
        );
  }

  async enqueueTokenSync(
    job:
      SyncTokenHoldingJob,
  ): Promise<void> {
    await this.queue.add(
      PORTFOLIO_JOB_NAMES
        .SYNC_TOKEN_HOLDING,

      job,

      {
        jobId:
          `${job.sourceEventId}:${job.portfolioId}`,
      },
    );
  }

  async enqueueRebuild(
    job:
      RebuildPortfolioJob,
  ): Promise<void> {
    await this.queue.add(
      PORTFOLIO_JOB_NAMES
        .REBUILD_PORTFOLIO,

      job,

      {
        jobId:
          `reorg:${job.sourceEventId}:${job.portfolioId}`,
      },
    );
  }

  async onModuleDestroy():
    Promise<void> {
    await this.queue
      .close();
  }
}
// RabbitMQ event-тен шыққан ауыр жұмыстарды Redis/BullMQ queue-ға жібереді.
