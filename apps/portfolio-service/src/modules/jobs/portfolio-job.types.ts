export const PORTFOLIO_JOB_NAMES = {
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

export type PortfolioJobData =
  | SyncTokenHoldingJob
  | RebuildPortfolioJob;
