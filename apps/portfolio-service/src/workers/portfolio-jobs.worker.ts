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
    eq,
} from 'drizzle-orm';

import {
    Erc20Client,
} from '@blockchain-explorer/blockchain-client';

import {
    BullMqFactory,
    type Job,
    type Worker,
} from '@blockchain-explorer/messaging';

import {
    DatabaseService,
} from '../database/database.service.js';

import {
    holdings,
    portfolios,
} from '../database/schema/index.js';

import {
    PORTFOLIO_JOB_NAMES,
    type PortfolioJobData,
    type PortfolioJobName,
    type RebuildPortfolioJob,
    type SyncTokenHoldingJob,
} from '../modules/jobs/portfolio-job.types.js';

@Injectable()
export class PortfolioJobsWorker
    implements
    OnApplicationBootstrap,
    OnApplicationShutdown {
    private readonly logger =
        new Logger(
            PortfolioJobsWorker.name,
        );

    private readonly factory:
        BullMqFactory;

    private readonly queueName:
        string;

    private readonly concurrency:
        number;

    private worker:
        Worker<
            PortfolioJobData,
            void,
            PortfolioJobName
        > | null =
        null;

    constructor(
        private readonly database:
            DatabaseService,

        private readonly erc20:
            Erc20Client,

        config:
            ConfigService,
    ) {
        this.factory =
            new BullMqFactory({
                redisUrl:
                    config
                        .getOrThrow<string>(
                            'REDIS_URL',
                        ),
            });

        this.queueName =
            config.get<string>(
                'PORTFOLIO_QUEUE_NAME',
            ) ??
            'portfolio-jobs';

        this.concurrency =
            Number(
                config.get(
                    'PORTFOLIO_WORKER_CONCURRENCY',
                ) ??
                5,
            );
    }

    onApplicationBootstrap():
        void {
        const worker =
            this.factory
                .createWorker<
                    PortfolioJobData,
                    void,
                    PortfolioJobName
                >(
                    this.queueName,

                    (
                        job,
                    ) =>
                        this.processJob(
                            job,
                        ),

                    this.concurrency,
                );

        this.worker = worker;

        worker.on(
            'completed',
            (
                job,
            ) => {
                this.logger.log(
                    `BullMQ job completed: ${job.name} (${job.id})`,
                );
            },
        );

        worker.on(
            'failed',
            (
                job,
                error,
            ) => {
                this.logger.error(
                    `BullMQ job failed: ${job?.name}`,
                    error.stack,
                );
            },
        );

        this.logger.log(
            'Portfolio BullMQ worker started',
        );
    }

    async onApplicationShutdown():
        Promise<void> {
        const worker =
            this.worker;

        if (
            worker
        ) {
            await worker
                .close();

            this.worker = null;
        }
    }

    private async processJob(
        job:
            Job<
                PortfolioJobData,
                void,
                PortfolioJobName
            >,
    ): Promise<void> {
        const data =
            job.data;

        switch (
        job.name
        ) {
            case PORTFOLIO_JOB_NAMES
                .SYNC_TOKEN_HOLDING:
                if (
                    !(
                        'walletAddress' in data &&
                        typeof data.walletAddress === 'string' &&
                        'tokenAddress' in data &&
                        typeof data.tokenAddress === 'string' &&
                        'blockNumber' in data &&
                        typeof data.blockNumber === 'string'
                    )
                ) {
                    throw new Error(
                        'Invalid sync-token-holding job data',
                    );
                }

                await this
                    .syncTokenHolding(
                        data,
                    );
                return;

            case PORTFOLIO_JOB_NAMES
                .REBUILD_PORTFOLIO:
                await this
                    .rebuildPortfolio(
                        data,
                    );
                return;

            default:
                throw new Error(
                    `Unknown portfolio job: ${job.name}`,
                );
        }
    }

    private async syncTokenHolding(
        job:
            SyncTokenHoldingJob,
    ): Promise<void> {
        const blockNumber =
            BigInt(
                job.blockNumber,
            );

        const [
            balanceResult,
            symbolResult,
            nameResult,
            decimalsResult,
        ] =
            await Promise.allSettled(
                [
                    this.erc20
                        .balanceOf(
                            job.tokenAddress,
                            job.walletAddress,
                            blockNumber,
                        ),

                    this.erc20
                        .symbol(
                            job.tokenAddress,
                            blockNumber,
                        ),

                    this.erc20
                        .name(
                            job.tokenAddress,
                            blockNumber,
                        ),

                    this.erc20
                        .decimals(
                            job.tokenAddress,
                            blockNumber,
                        ),
                ],
            );

        if (
            balanceResult.status !==
            'fulfilled'
        ) {
            throw balanceResult
                .reason;
        }

        const symbol =
            symbolResult.status ===
                'fulfilled'
                ? symbolResult.value ??
                'UNKNOWN'
                : 'UNKNOWN';

        const name =
            nameResult.status ===
                'fulfilled'
                ? nameResult.value
                : null;

        const decimals =
            decimalsResult.status ===
                'fulfilled'
                ? decimalsResult.value
                : 18;

        const assetKey =
            `erc20:${job.tokenAddress.toLowerCase()}`;

        await this.database.db
            .insert(
                holdings,
            )
            .values({
                portfolioId:
                    job.portfolioId,

                assetKey,

                assetType:
                    'erc20',

                tokenAddress:
                    job.tokenAddress
                        .toLowerCase(),

                symbol,

                name,

                decimals,

                balanceRaw:
                    balanceResult
                        .value
                        .toString(),

                lastUpdatedBlock:
                    blockNumber,

                updatedAt:
                    new Date(),
            })
            .onConflictDoUpdate({
                target: [
                    holdings
                        .portfolioId,

                    holdings
                        .assetKey,
                ],

                set: {
                    symbol,

                    name,

                    decimals,

                    balanceRaw:
                        balanceResult
                            .value
                            .toString(),

                    lastUpdatedBlock:
                        blockNumber,

                    updatedAt:
                        new Date(),
                },
            });
    }

    private async rebuildPortfolio(
        job:
            RebuildPortfolioJob,
    ): Promise<void> {
        const [portfolio] =
            await this.database.db
                .select()
                .from(
                    portfolios,
                )
                .where(
                    eq(
                        portfolios.id,
                        job.portfolioId,
                    ),
                )
                .limit(1);

        if (!portfolio) {
            return;
        }

        const portfolioHoldings =
            await this.database.db
                .select()
                .from(
                    holdings,
                )
                .where(
                    eq(
                        holdings
                            .portfolioId,

                        portfolio.id,
                    ),
                );

        for (
            const holding of
            portfolioHoldings
        ) {
            if (
                holding.assetType !==
                'erc20' ||
                !holding.tokenAddress
            ) {
                continue;
            }

            const balance =
                await this.erc20
                    .balanceOf(
                        holding
                            .tokenAddress,

                        portfolio
                            .walletAddress,

                        'latest',
                    );

            await this.database.db
                .update(
                    holdings,
                )
                .set({
                    balanceRaw:
                        balance
                            .toString(),

                    updatedAt:
                        new Date(),
                })
                .where(
                    eq(
                        holdings.id,
                        holding.id,
                    ),
                );
        }
    }
}
// BullMQ background job арқылы ERC-20 wallet balance-ын blockchain-нан қайта оқып holdings кестесін жаңартады.
