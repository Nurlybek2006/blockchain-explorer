import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnModuleDestroy,
} from '@nestjs/common';

import {
    ConfigService,
} from '@nestjs/config';

import {
    and,
    eq,
    isNull,
    lte,
    or,
} from 'drizzle-orm';

import {
    Erc20Client,
    EthereumRpcClient,
} from '@blockchain-explorer/blockchain-client';

import {
    BullMqFactory,
    type Job,
    type Worker,
} from '@blockchain-explorer/messaging';
import { isAssetKey, isTokenTransferIndexedEvent } from '@blockchain-explorer/contracts';
import { PricesService } from '../modules/prices/prices.service.js';
import { AnalyticsService } from '../modules/analytics/analytics.service.js';
import { AlertsService } from '../modules/alerts/alerts.service.js';

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
    type InitialPortfolioSyncJob,
    type PortfolioJobName,
    type RebuildPortfolioJob,
    type SyncTokenHoldingJob,
} from '../modules/jobs/portfolio-job.types.js';

@Injectable()
export class PortfolioJobsWorker
    implements
    OnApplicationBootstrap,
    OnModuleDestroy {
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

    private readonly chainId: number;

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

        private readonly rpc: EthereumRpcClient,

        config:
            ConfigService,
        private readonly prices: PricesService,
        private readonly analytics: AnalyticsService,
        private readonly alerts: AlertsService,
    ) {
        this.chainId = Number(config.get('ETHEREUM_CHAIN_ID') ?? 11155111);
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

        worker.on('error', (error) => {
            this.logger.error('Portfolio BullMQ worker error', error.stack);
        });

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

    async onModuleDestroy():
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
            case PORTFOLIO_JOB_NAMES.REFRESH_ASSET_PRICE:
                if (!('assetKey' in data) || !isAssetKey(data.assetKey)) throw new Error('Invalid price refresh job data');
                await this.prices.refreshAsset(data.assetKey);
                return;
            case PORTFOLIO_JOB_NAMES.REFRESH_ACTIVE_PRICES:
                if (!('scope' in data) || data.scope !== 'active') throw new Error('Invalid active price job data');
                await this.prices.refreshActivePrices();
                return;
            case PORTFOLIO_JOB_NAMES.SNAPSHOT_PORTFOLIO:
                if (!('portfolioId' in data) || typeof data.portfolioId !== 'string') throw new Error('Invalid snapshot job data');
                await this.analytics.snapshotPortfolio(data.portfolioId);
                return;
            case PORTFOLIO_JOB_NAMES.REFRESH_PORTFOLIO_VALUATIONS:
                if (!('scope' in data) || data.scope !== 'active') throw new Error('Invalid valuation job data');
                await this.analytics.refreshPortfolioValuations();
                for (const portfolio of await this.database.db.select({ id: portfolios.id }).from(portfolios).where(isNull(portfolios.archivedAt))) {
                    await this.analytics.snapshotPortfolio(portfolio.id);
                }
                return;
            case PORTFOLIO_JOB_NAMES.EVALUATE_TRANSFER_ALERTS:
                if (!('event' in data) || !isTokenTransferIndexedEvent(data.event)) throw new Error('Invalid transfer alert job data');
                if (data.event.payload.chainId !== this.chainId) return;
                await this.alerts.evaluateTransfer(data.event);
                return;
            case PORTFOLIO_JOB_NAMES.SYNC_PORTFOLIO:
                if (!('chainId' in data) || typeof data.chainId !== 'number' ||
                    !Number.isSafeInteger(data.chainId) || data.chainId < 1 ||
                    'walletAddress' in data || 'sourceEventId' in data) {
                    throw new Error('Invalid sync-portfolio job data');
                }
                await this.rebuildPortfolio(data);
                await this.analytics.snapshotPortfolio(data.portfolioId);
                return;
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
                if (!('sourceEventId' in data) || typeof data.sourceEventId !== 'string' ||
                    'walletAddress' in data || 'chainId' in data) {
                    throw new Error('Invalid rebuild-portfolio job data');
                }
                await this
                    .rebuildPortfolio(
                        data,
                        true,
                    );
                await this.analytics.snapshotPortfolio(data.portfolioId);
                return;

            default:
                throw new Error(
                    'Unknown portfolio job',
                );
        }
    }

    private async syncTokenHolding(
        job:
            SyncTokenHoldingJob,
    ): Promise<void> {
        const [portfolio] = await this.database.db.select()
            .from(portfolios)
            .where(and(eq(portfolios.id, job.portfolioId), isNull(portfolios.archivedAt)))
            .limit(1);
        if (!portfolio) return;
        if (portfolio.chainId !== this.chainId ||
            portfolio.walletAddress !== job.walletAddress.toLowerCase()) {
            throw new Error('Portfolio token job does not match its wallet or configured chain');
        }
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
                setWhere: or(isNull(holdings.lastUpdatedBlock), lte(holdings.lastUpdatedBlock, blockNumber)),
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
            RebuildPortfolioJob | InitialPortfolioSyncJob,
        allowRollback = false,
    ): Promise<void> {
        const [portfolio] =
            await this.database.db
                .select()
                .from(
                    portfolios,
                )
                .where(
                    and(eq(
                        portfolios.id,
                        job.portfolioId,
                    ), isNull(portfolios.archivedAt)),
                )
                .limit(1);

        if (!portfolio) {
            return;
        }

        if (portfolio.chainId !== this.chainId ||
            ('chainId' in job && job.chainId !== portfolio.chainId)) {
            throw new Error('Portfolio sync job does not match the configured chain');
        }
        const rpcChainId = await this.rpc.getChainId();
        if (rpcChainId !== portfolio.chainId) {
            throw new Error('Ethereum RPC endpoint chain does not match portfolio chain');
        }
        const blockNumber = await this.rpc.getBlockNumber();
        const nativeBalance = await this.rpc.getBalance(portfolio.walletAddress, blockNumber);
        await this.database.db.insert(holdings).values({
            portfolioId: portfolio.id,
            assetKey: 'native:eth',
            assetType: 'native',
            tokenAddress: null,
            symbol: 'ETH',
            name: 'Ether',
            decimals: 18,
            balanceRaw: nativeBalance.toString(),
            lastUpdatedBlock: blockNumber,
            updatedAt: new Date(),
        }).onConflictDoUpdate({
            setWhere: allowRollback ? undefined : or(isNull(holdings.lastUpdatedBlock), lte(holdings.lastUpdatedBlock, blockNumber)),
            target: [holdings.portfolioId, holdings.assetKey],
            set: {
                balanceRaw: nativeBalance.toString(),
                lastUpdatedBlock: blockNumber,
                updatedAt: new Date(),
            },
        });

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

                        blockNumber,
                    );

            await this.database.db
                .update(
                    holdings,
                )
                .set({
                    lastUpdatedBlock: blockNumber,
                    balanceRaw:
                        balance
                            .toString(),

                    updatedAt:
                        new Date(),
                })
                .where(
                    and(eq(
                        holdings.id,
                        holding.id,
                    ), allowRollback ? undefined : or(isNull(holdings.lastUpdatedBlock), lte(holdings.lastUpdatedBlock, blockNumber))),
                );
        }
    }
}
// BullMQ background job арқылы ERC-20 wallet balance-ын blockchain-нан қайта оқып holdings кестесін жаңартады.
