import {
  Injectable,
  Logger,
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
  type InitialPortfolioSyncJob,
  type PortfolioJobData,
  type PortfolioJobName,
  type RebuildPortfolioJob,
  type SyncTokenHoldingJob,
} from './portfolio-job.types.js';

@Injectable()
export class PortfolioJobsService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(PortfolioJobsService.name);
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
    this.queue.on('error', (error) => {
      this.logger.error('Portfolio BullMQ queue error', error.stack);
    });
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
          `sync-${job.sourceEventId}-${job.portfolioId}`,
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
          `reorg-${job.sourceEventId}-${job.portfolioId}`,
      },
    );
  }

  async enqueueInitialSync(job: InitialPortfolioSyncJob): Promise<void> {
    await this.enqueueWithDeadline(this.queue.add(PORTFOLIO_JOB_NAMES.SYNC_PORTFOLIO, job, {
      jobId: `initial-${job.portfolioId}`,
    }));
  }

  private async enqueueWithDeadline(operation: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Portfolio queue enqueue timed out')), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<void> {
    await this.queue.getJobCounts('waiting');
  }

  async onModuleDestroy():
    Promise<void> {
    await this.queue
      .close();
  }
}
// RabbitMQ event-тен шыққан ауыр жұмыстарды Redis/BullMQ queue-ға жібереді.
