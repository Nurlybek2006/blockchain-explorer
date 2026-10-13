import type { PortfolioValuationSummary } from './intelligence.contracts.js';

export interface PortfolioCreateInput {
  name: string;
  walletAddress: string;
  chainId?: number;
}

export interface PortfolioUpdateInput {
  name: string;
}

export interface PortfolioResponse {
  id: string;
  name: string;
  walletAddress: string;
  chainId: number;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioHoldingResponse {
  assetKey: string;
  assetType: string;
  tokenAddress: string | null;
  symbol: string;
  name: string | null;
  decimals: number;
  balanceRaw: string;
  balanceFormatted: string;
  lastUpdatedBlock: string | null;
  updatedAt: string;
  priceUsd?: string | null;
  valueUsd?: string | null;
  change24hPercent?: string | null;
  priceFetchedAt?: string | null;
  priceStale?: boolean;
}

export interface PortfolioDetailResponse extends PortfolioResponse {
  holdings: PortfolioHoldingResponse[];
  summary?: PortfolioValuationSummary;
}

export interface PortfolioListResponse {
  items: PortfolioResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
