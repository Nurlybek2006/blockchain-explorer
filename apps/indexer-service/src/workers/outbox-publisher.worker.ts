import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';

import {
    ConfigService,
} from '@nestjs/config';

import {
    and,
    asc,
    eq,
    lte,
    sql,
    inArray,
} from 'drizzle-orm';
import { recordGauge, withTraceContext } from '@blockchain-explorer/observability';

import {
    isEventEnvelope,
} from '@blockchain-explorer/contracts';

import {
    DatabaseService,
} from '../database/database.service.js';

import {
    outboxEvents,
} from '../database/schema/index.js';

import {
    RabbitMqPublisherService,
} from '../modules/messaging/rabbitmq-publisher.service.js';

@Injectable()
export class OutboxPublisherWorker
    implements
    OnApplicationBootstrap,
    OnApplicationShutdown {
    private readonly logger =
        new Logger(
            OutboxPublisherWorker.name,
        );

    private readonly pollIntervalMs:
        number;

    private readonly batchSize:
        number;

    private readonly processingTimeoutMs:
        number;

    private readonly maxRetryDelayMs:
        number;

    private stopping =
        false;
    private nextBacklogObservationAt = 0;

    private loopPromise:
        Promise<void> | null =
        null;

    constructor(
        private readonly database:
            DatabaseService,

        private readonly publisher:
            RabbitMqPublisherService,

        config:
            ConfigService,
    ) {
        this.pollIntervalMs =
            Number(
                config.get(
                    'OUTBOX_POLL_INTERVAL_MS',
                ) ??
                1000,
            );

        this.batchSize =
            Number(
                config.get(
                    'OUTBOX_BATCH_SIZE',
                ) ??
                100,
            );

        this.processingTimeoutMs =
            Number(
                config.get(
                    'OUTBOX_PROCESSING_TIMEOUT_MS',
                ) ??
                60_000,
            );

        this.maxRetryDelayMs =
            Number(
                config.get(
                    'OUTBOX_MAX_RETRY_DELAY_MS',
                ) ??
                60_000,
            );
    }

    onApplicationBootstrap():
        void {
        this.loopPromise =
            this.runLoop();
    }

    async onApplicationShutdown():
        Promise<void> {
        this.stopping =
            true;

        if (
            this.loopPromise
        ) {
            await this.loopPromise;
        }
    }

    private async runLoop():
        Promise<void> {
        while (
            !this.stopping
        ) {
            try {
                await this.observeBacklog();
                await this
                    .recoverStaleJobs();

                const processed =
                    await this
                        .processBatch();

                if (
                    processed ===
                    0
                ) {
                    await sleep(
                        this.pollIntervalMs,
                    );
                }
            } catch (
            error
            ) {
                this.logger.error(
                    'Outbox publisher iteration failed',
                    error instanceof Error
                        ? error.stack
                        : String(
                            error,
                        ),
                );

                await sleep(
                    this.pollIntervalMs,
                );
            }
        }
    }

    private async recoverStaleJobs():
        Promise<void> {
        await this.database.db
            .update(
                outboxEvents,
            )
            .set({
                status:
                    'pending',
            })
            .where(
                and(
                    eq(
                        outboxEvents.status,
                        'processing',
                    ),

                    lte(
                        outboxEvents
                            .availableAt,

                        new Date(),
                    ),
                ),
            );
    }

    private async processBatch():
        Promise<number> {
        const rows =
            await this.database.db
                .select()
                .from(
                    outboxEvents,
                )
                .where(
                    and(
                        eq(
                            outboxEvents.status,
                            'pending',
                        ),

                        lte(
                            outboxEvents
                                .availableAt,

                            new Date(),
                        ),
                    ),
                )
                .orderBy(
                    asc(
                        outboxEvents
                            .createdAt,
                    ),
                )
                .limit(
                    this.batchSize,
                );

        for (
            const row of rows
        ) {
            const claimed =
                await this.claim(
                    row.id,
                );

            if (!claimed) {
                continue;
            }

            try {
                if (
                    !isEventEnvelope(
                        row.payload,
                    )
                ) {
                    throw new Error(
                        `Invalid outbox payload: ${row.id}`,
                    );
                }

                const event = row.payload;
                await withTraceContext(event.metadata?.traceContext, () => this.publisher.publish(event));

                await this.database.db
                    .update(
                        outboxEvents,
                    )
                    .set({
                        status:
                            'published',

                        publishedAt:
                            new Date(),
                    })
                    .where(
                        eq(
                            outboxEvents.id,
                            row.id,
                        ),
                    );
            } catch {
                const attempts =
                    row.attempts +
                    1;

                const delay =
                    Math.min(
                        1000 *
                        2 **
                        Math.min(
                            attempts,
                            10,
                        ),

                        this.maxRetryDelayMs,
                    );

                await this.database.db
                    .update(
                        outboxEvents,
                    )
                    .set({
                        status:
                            'pending',

                        availableAt:
                            new Date(
                                Date.now() +
                                delay,
                            ),
                    })
                    .where(
                        eq(
                            outboxEvents.id,
                            row.id,
                        ),
                    );

                this.logger.warn(
                    `Outbox event ${row.id} publish failed`,
                );
            }
        }

        return rows.length;
    }

    private async observeBacklog(): Promise<void> {
        if (Date.now() < this.nextBacklogObservationAt) return;
        this.nextBacklogObservationAt = Date.now() + 15_000;
        // Bounded-frequency aggregates; scrapes read cached gauge values without database queries.
        // A metrics-only observation failure never interrupts publishing committed business events.
        try {
            const [row] = await this.database.db.select({
                backlog: sql<number>`count(*)::integer`,
                oldestSeconds: sql<number>`coalesce(extract(epoch from (now() - min(${outboxEvents.createdAt})))::double precision, 0)`,
            }).from(outboxEvents).where(inArray(outboxEvents.status, ['pending', 'processing']));
            recordGauge('indexer_outbox_backlog', row?.backlog ?? 0);
            recordGauge('indexer_outbox_oldest_pending_age_seconds', Math.max(0, row?.oldestSeconds ?? 0));
        } catch {
            recordGauge('indexer_outbox_backlog', null);
            recordGauge('indexer_outbox_oldest_pending_age_seconds', null);
        }
    }

    private async claim(
        id: string,
    ): Promise<boolean> {
        const rows =
            await this.database.db
                .update(
                    outboxEvents,
                )
                .set({
                    status:
                        'processing',

                    attempts:
                        sql`${outboxEvents.attempts} + 1`,

                    availableAt:
                        new Date(
                            Date.now() +
                            this.processingTimeoutMs,
                        ),
                })
                .where(
                    and(
                        eq(
                            outboxEvents.id,
                            id,
                        ),

                        eq(
                            outboxEvents.status,
                            'pending',
                        ),
                    ),
                )
                .returning({
                    id:
                        outboxEvents.id,
                });

        return rows.length > 0;
    }
}


function sleep(
    milliseconds: number,
): Promise<void> {
    return new Promise(
        (
            resolve,
        ) => {
            setTimeout(
                resolve,
                milliseconds,
            );
        },
    );
}
// Outbox event-терді RabbitMQ-ға background режимде жариялайды. Crash немесе RabbitMQ failure болса event жоғалмайды және кейін қайта жіберіледі.
