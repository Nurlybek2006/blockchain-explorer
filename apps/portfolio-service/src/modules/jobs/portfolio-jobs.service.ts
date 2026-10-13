import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  BullMqFactory,
  type Queue,
} from '@blockchain-explorer/messaging';
import { createHash } from 'node:crypto';
import type { TokenTransferIndexedEvent } from '@blockchain-explorer/contracts';
import { PricesService } from '../prices/prices.service.js';

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
  implements OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(PortfolioJobsService.name);
  private readonly priceInterval: number;
  private readonly snapshotInterval: number;
  private readonly schedulerEnabled: boolean;
  readonly queue:
    Queue<
      PortfolioJobData,
      void,
      PortfolioJobName
    >;

  constructor(
    config:
      ConfigService,
    private readonly prices: PricesService,
  ) {
    this.priceInterval = readInterval(config, 'PRICE_REFRESH_INTERVAL_MS', 60_000);
    this.snapshotInterval = readInterval(config, 'PORTFOLIO_SNAPSHOT_INTERVAL_MS', 300_000);
    const enabled = config.get<unknown>('PRICE_SCHEDULER_ENABLED') ?? 'true';
    if (enabled !== true && enabled !== false && enabled !== 'true' && enabled !== 'false') throw new Error('PRICE_SCHEDULER_ENABLED must be true or false');
    this.schedulerEnabled = enabled === true || enabled === 'true';
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

  onApplicationBootstrap(): void {
    this.prices.setRefreshScheduler((assetKey) => this.enqueueRefreshAsset(assetKey));
    void this.configureSchedulers().catch((error: unknown) => {
      this.logger.warn(`Portfolio intelligence scheduling unavailable: ${error instanceof Error ? error.name : 'queue error'}`);
    });
  }

  private async configureSchedulers(): Promise<void> {
    if (!this.schedulerEnabled) {
      await Promise.all([
        this.queue.removeJobScheduler(PORTFOLIO_JOB_NAMES.REFRESH_ACTIVE_PRICES),
        this.queue.removeJobScheduler(PORTFOLIO_JOB_NAMES.REFRESH_PORTFOLIO_VALUATIONS),
      ]);
      return;
    }
    await this.queue.upsertJobScheduler(PORTFOLIO_JOB_NAMES.REFRESH_ACTIVE_PRICES, { every: this.priceInterval }, {
      name: PORTFOLIO_JOB_NAMES.REFRESH_ACTIVE_PRICES, data: { scope: 'active' },
    });
    await this.queue.upsertJobScheduler(PORTFOLIO_JOB_NAMES.REFRESH_PORTFOLIO_VALUATIONS, { every: this.snapshotInterval }, {
      name: PORTFOLIO_JOB_NAMES.REFRESH_PORTFOLIO_VALUATIONS, data: { scope: 'active' },
    });
    await this.queue.add(PORTFOLIO_JOB_NAMES.REFRESH_ACTIVE_PRICES, { scope: 'active' }, {
      jobId: `price-bootstrap-${Math.floor(Date.now() / this.priceInterval)}`,
    });
  }

  async enqueueRefreshAsset(assetKey: string): Promise<void> {
    const key = createHash('sha256').update(assetKey).digest('hex');
    await this.enqueueWithDeadline(this.queue.add(PORTFOLIO_JOB_NAMES.REFRESH_ASSET_PRICE, { assetKey }, {
      jobId: `price-${key}-${Math.floor(Date.now() / 30_000)}`,
    }));
  }

  async enqueueSnapshot(portfolioId: string): Promise<void> {
    await this.enqueueWithDeadline(this.queue.add(PORTFOLIO_JOB_NAMES.SNAPSHOT_PORTFOLIO, { portfolioId }, {
      jobId: `snapshot-${portfolioId}-${Math.floor(Date.now() / this.snapshotInterval)}`,
    }));
  }

  async enqueueTransferAlerts(event: TokenTransferIndexedEvent): Promise<void> {
    const key = createHash('sha256').update(event.id).digest('hex');
    await this.queue.add(PORTFOLIO_JOB_NAMES.EVALUATE_TRANSFER_ALERTS, { event }, { jobId: `alerts-${key}` });
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

function readInterval(config: ConfigService, key: string, fallback: number): number {
  const value = Number(config.get(key) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 86_400_000) throw new Error(`${key} must be between 1000 and 86400000 milliseconds`);
  return value;
}
// RabbitMQ event-тен шыққан ауыр жұмыстарды Redis/BullMQ queue-ға жібереді.
