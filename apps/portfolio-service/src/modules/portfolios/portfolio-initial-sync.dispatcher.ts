import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { outboxEvents } from '../../database/schema/index.js';
import { PortfolioJobsService } from '../jobs/portfolio-jobs.service.js';
import { INITIAL_SYNC_EVENT_TYPE, isInitialPortfolioSyncPayload } from './portfolio-initial-sync.js';

/** Publish committed initial-sync intents to BullMQ with retry after Redis outages. */
@Injectable()
export class PortfolioInitialSyncDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PortfolioInitialSyncDispatcher.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'db'>,
    @Inject(PortfolioJobsService)
    private readonly jobs: Pick<PortfolioJobsService, 'enqueueInitialSync'>,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => { void this.flush(); }, 1_000);
    this.timer.unref();
    void this.flush();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.active) {
      await this.active;
    }
  }

  flush(): Promise<void> {
    if (this.stopping) {
      return Promise.resolve();
    }
    if (!this.active) {
      this.active = this.drain().catch((error: unknown) => {
        this.logger.error('Initial portfolio sync dispatch failed', error instanceof Error ? error.stack : undefined);
      }).finally(() => { this.active = null; });
    }
    return this.active;
  }

  private async drain(): Promise<void> {
    for (let index = 0; index < 25 && !this.stopping; index += 1) {
      const found = await this.database.db.transaction(async (transaction) => {
        const [intent] = await transaction.select().from(outboxEvents)
          .where(and(
            eq(outboxEvents.eventType, INITIAL_SYNC_EVENT_TYPE),
            eq(outboxEvents.status, 'pending'),
            lte(outboxEvents.availableAt, new Date()),
          ))
          .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!intent) {
          return false;
        }

        if (!isInitialPortfolioSyncPayload(intent.payload)) {
          await transaction.update(outboxEvents).set({ status: 'failed' })
            .where(eq(outboxEvents.id, intent.id));
          this.logger.error(`Invalid initial sync intent ${intent.id}`);
          return true;
        }

        try {
          // A transaction-held row lock excludes other service instances.
          // Deterministic BullMQ IDs cover crashes between enqueue and commit.
          await this.jobs.enqueueInitialSync(intent.payload);
          await transaction.update(outboxEvents)
            .set({ status: 'published', publishedAt: new Date(), attempts: intent.attempts + 1 })
            .where(eq(outboxEvents.id, intent.id));
        } catch (error) {
          const attempts = intent.attempts + 1;
          const delayMs = Math.min(1_000 * 2 ** Math.min(attempts, 6), 60_000);
          await transaction.update(outboxEvents)
            .set({ attempts, availableAt: new Date(Date.now() + delayMs) })
            .where(eq(outboxEvents.id, intent.id));
          this.logger.warn(`Initial sync intent ${intent.id} will retry: ${error instanceof Error ? error.name : 'queue error'}`);
        }
        return true;
      });
      if (!found) {
        return;
      }
    }
  }
}
