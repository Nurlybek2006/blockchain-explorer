import type { TokenTransferIndexedEvent } from '@blockchain-explorer/contracts';

export const PORTFOLIO_JOB_NAMES = {
  REFRESH_ASSET_PRICE: 'refresh-asset-price',
  REFRESH_ACTIVE_PRICES: 'refresh-active-prices',
  SNAPSHOT_PORTFOLIO: 'snapshot-portfolio',
  REFRESH_PORTFOLIO_VALUATIONS: 'refresh-portfolio-valuations',
  EVALUATE_TRANSFER_ALERTS: 'evaluate-transfer-alerts',
  SYNC_PORTFOLIO: 'sync-portfolio',
  SYNC_TOKEN_HOLDING:
    'sync-token-holding',

  REBUILD_PORTFOLIO:
    'rebuild-portfolio',
} as const;

export type PortfolioJobName =
  (typeof PORTFOLIO_JOB_NAMES)[
    keyof typeof PORTFOLIO_JOB_NAMES
  ];

export interface SyncTokenHoldingJob {
  portfolioId: string;

  walletAddress: string;

  tokenAddress: string;

  blockNumber: string;

  sourceEventId: string;
}

export interface RebuildPortfolioJob {
  portfolioId: string;

  sourceEventId: string;
}

export interface InitialPortfolioSyncJob {
  portfolioId: string;
  chainId: number;
}

export interface RefreshAssetPriceJob { assetKey: string; }
export interface ActivePortfolioIntelligenceJob { scope: 'active'; }
export interface SnapshotPortfolioJob { portfolioId: string; }
export interface EvaluateTransferAlertsJob { event: TokenTransferIndexedEvent; }

export type PortfolioJobData =
  | SyncTokenHoldingJob
  | RebuildPortfolioJob
  | InitialPortfolioSyncJob
  | RefreshAssetPriceJob
  | ActivePortfolioIntelligenceJob
  | SnapshotPortfolioJob
  | EvaluateTransferAlertsJob;
