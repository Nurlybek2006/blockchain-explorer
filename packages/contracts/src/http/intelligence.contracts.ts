import type { PortfolioHoldingResponse, PortfolioResponse } from './portfolio.contracts.js';

export interface AssetPriceResponse {
  assetKey: string;
  tokenAddress: string | null;
  coinGeckoId: string | null;
  symbol: string | null;
  priceUsd: string | null;
  change24hPercent: string | null;
  marketCapUsd: string | null;
  fetchedAt: string | null;
  availability: 'available' | 'unavailable';
  stale: boolean;
}

export interface PortfolioValuationSummary {
  totalValueUsd: string | null;
  pricedValueUsd: string;
  assetCount: number;
  pricedAssetCount: number;
  unpricedAssetCount: number;
  complete: boolean;
  change24hUsd: string | null;
  change24hPercent: string | null;
  marketChangeComplete: boolean;
  staleAssetCount: number;
}

export interface PortfolioValuedHoldingResponse extends PortfolioHoldingResponse {
  priceUsd: string | null;
  valueUsd: string | null;
  change24hPercent: string | null;
  priceFetchedAt: string | null;
  priceStale: boolean;
}

export interface PortfolioValuationResponse {
  portfolio: PortfolioResponse;
  summary: PortfolioValuationSummary;
  holdings: PortfolioValuedHoldingResponse[];
}

export type PortfolioHistoryRange = '24h' | '7d' | '30d' | '90d';
export interface PortfolioHistoryResponse {
  range: PortfolioHistoryRange;
  points: { timestamp: string; valueUsd: string }[];
}

export interface PortfolioAssetPerformance {
  assetKey: string;
  symbol: string;
  change24hPercent: string;
}

export interface PortfolioAnalyticsResponse {
  totalValueUsd: string | null;
  pricedValueUsd: string;
  change24hUsd: string | null;
  change24hPercent: string | null;
  historicalChange24hUsd: string | null;
  historicalChange24hPercent: string | null;
  bestAsset: PortfolioAssetPerformance | null;
  worstAsset: PortfolioAssetPerformance | null;
  allocation: { assetKey: string; symbol: string; valueUsd: string; percentage: string }[];
  pricedAssetCount: number;
  unpricedAssetCount: number;
  complete: boolean;
  marketChangeComplete: boolean;
  allocationBasis: 'priced_assets';
  pnlAvailable: false;
  pnlReason: 'cost_basis_unavailable';
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface WatchlistCreateInput { name: string; }
export interface WatchlistUpdateInput { name: string; }
export type WatchlistItemType = 'address' | 'token';
export interface WatchlistItemCreateInput {
  itemType: WatchlistItemType;
  address: string;
  label?: string;
}
export interface WatchlistResponse { id: string; name: string; createdAt: string; }
export interface WatchlistItemResponse {
  id: string;
  watchlistId: string;
  itemType: WatchlistItemType;
  address: string;
  label: string | null;
  createdAt: string;
}
export interface WatchlistDetailResponse extends WatchlistResponse { items: WatchlistItemResponse[]; }
export type WatchlistListResponse = PaginatedResponse<WatchlistResponse>;

export type AlertType = 'whale' | 'price_above' | 'price_below' | 'wallet_activity';
export interface AlertCreateInput {
  type: AlertType;
  enabled?: boolean;
  walletAddress?: string | null;
  tokenAddress?: string | null;
  thresholdUsd?: string;
}
export interface AlertUpdateInput {
  type?: AlertType;
  enabled?: boolean;
  walletAddress?: string | null;
  tokenAddress?: string | null;
  thresholdUsd?: string | null;
}
export interface AlertResponse {
  id: string;
  type: AlertType;
  enabled: boolean;
  walletAddress: string | null;
  tokenAddress: string | null;
  thresholdUsd: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AlertEventResponse {
  id: string;
  alertId: string;
  title: string;
  message: string | null;
  payload: unknown;
  triggeredAt: string;
  readAt: string | null;
}
export type AlertListResponse = PaginatedResponse<AlertResponse>;
export type AlertEventListResponse = PaginatedResponse<AlertEventResponse>;
