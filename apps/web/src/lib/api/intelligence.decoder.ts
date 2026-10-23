import type {
  AlertEventListResponse, AlertEventResponse, AlertListResponse, AlertResponse, AlertType,
  AssetPriceResponse, PaginatedResponse, PortfolioAnalyticsResponse, PortfolioAssetPerformance,
  PortfolioDetailResponse, PortfolioHistoryRange, PortfolioHistoryResponse, PortfolioHoldingResponse,
  PortfolioListResponse, PortfolioResponse, PortfolioValuationResponse, PortfolioValuationSummary,
  WatchlistDetailResponse, WatchlistItemResponse, WatchlistListResponse, WatchlistResponse,
} from '@blockchain-explorer/contracts';
import { ContractError } from './fields';

function invalid(): never { throw new ContractError(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalid();
  return value;
}
function string(value: unknown): string { return typeof value === 'string' ? value : invalid(); }
function nullableString(value: unknown): string | null { return value === null ? null : string(value); }
function decimal(value: unknown): string {
  const result = string(value);
  return /^-?\d+(?:\.\d+)?$/.test(result) ? result : invalid();
}
function nullableDecimal(value: unknown): string | null { return value === null ? null : decimal(value); }
function timestamp(value: unknown): string {
  const result = string(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function nullableTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value); }
function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function array<T>(value: unknown, decode: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map((item: unknown) => decode(item)) : invalid();
}
function page<T>(value: unknown, decode: (item: unknown) => T): PaginatedResponse<T> {
  const data = object(value);
  const result = { items: array(data.items, decode), page: integer(data.page), limit: integer(data.limit), total: integer(data.total), totalPages: integer(data.totalPages) };
  return result.page > 0 && result.limit > 0 ? result : invalid();
}
export function decodePortfolio(value: unknown): PortfolioResponse {
  const data = object(value);
  return { id: string(data.id), name: string(data.name), walletAddress: string(data.walletAddress), chainId: integer(data.chainId), isPrimary: boolean(data.isPrimary), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) };
}
function decodeHolding(value: unknown): PortfolioHoldingResponse {
  const data = object(value);
  return {
    assetKey: string(data.assetKey), assetType: string(data.assetType), tokenAddress: nullableString(data.tokenAddress), symbol: string(data.symbol), name: nullableString(data.name), decimals: integer(data.decimals), balanceRaw: decimal(data.balanceRaw), balanceFormatted: decimal(data.balanceFormatted), lastUpdatedBlock: nullableString(data.lastUpdatedBlock), updatedAt: timestamp(data.updatedAt),
    ...(data.priceUsd === undefined ? {} : { priceUsd: nullableDecimal(data.priceUsd) }),
    ...(data.valueUsd === undefined ? {} : { valueUsd: nullableDecimal(data.valueUsd) }),
    ...(data.change24hPercent === undefined ? {} : { change24hPercent: nullableDecimal(data.change24hPercent) }),
    ...(data.priceFetchedAt === undefined ? {} : { priceFetchedAt: nullableTimestamp(data.priceFetchedAt) }),
    ...(data.priceStale === undefined ? {} : { priceStale: boolean(data.priceStale) }),
  };
}
export function decodeSummary(value: unknown): PortfolioValuationSummary {
  const data = object(value);
  return { totalValueUsd: nullableDecimal(data.totalValueUsd), pricedValueUsd: decimal(data.pricedValueUsd), assetCount: integer(data.assetCount), pricedAssetCount: integer(data.pricedAssetCount), unpricedAssetCount: integer(data.unpricedAssetCount), complete: boolean(data.complete), change24hUsd: nullableDecimal(data.change24hUsd), change24hPercent: nullableDecimal(data.change24hPercent), marketChangeComplete: boolean(data.marketChangeComplete), staleAssetCount: integer(data.staleAssetCount) };
}
export function decodePortfolioDetail(value: unknown): PortfolioDetailResponse {
  const data = object(value);
  return { ...decodePortfolio(data), holdings: array(data.holdings, decodeHolding), ...(data.summary === undefined ? {} : { summary: decodeSummary(data.summary) }) };
}
export function decodePortfolioList(value: unknown): PortfolioListResponse { return page(value, decodePortfolio); }
export function decodeValuation(value: unknown): PortfolioValuationResponse {
  const data = object(value);
  return { portfolio: decodePortfolio(data.portfolio), summary: decodeSummary(data.summary), holdings: array(data.holdings, (item) => {
    const holding = object(item);
    return { ...decodeHolding(holding), priceUsd: nullableDecimal(holding.priceUsd), valueUsd: nullableDecimal(holding.valueUsd), change24hPercent: nullableDecimal(holding.change24hPercent), priceFetchedAt: nullableTimestamp(holding.priceFetchedAt), priceStale: boolean(holding.priceStale) };
  }) };
}
export function isHistoryRange(value: string): value is PortfolioHistoryRange { return value === '24h' || value === '7d' || value === '30d' || value === '90d'; }
export function decodeHistory(value: unknown): PortfolioHistoryResponse {
  const data = object(value);
  const range = string(data.range);
  if (!isHistoryRange(range)) return invalid();
  return { range, points: array(data.points, (item) => { const point = object(item); return { timestamp: timestamp(point.timestamp), valueUsd: decimal(point.valueUsd) }; }) };
}
function performance(value: unknown): PortfolioAssetPerformance | null {
  if (value === null) return null;
  const data = object(value);
  return { assetKey: string(data.assetKey), symbol: string(data.symbol), change24hPercent: decimal(data.change24hPercent) };
}
export function decodeAnalytics(value: unknown): PortfolioAnalyticsResponse {
  const data = object(value);
  if (data.allocationBasis !== 'priced_assets' || typeof data.pnlAvailable !== 'boolean'
    || (data.pnlAvailable ? data.pnlReason !== null : !['cost_basis_unavailable', 'history_incomplete', 'price_unavailable'].includes(string(data.pnlReason)))) return invalid();
  const pnlReason = data.pnlReason;
  if (pnlReason !== null && pnlReason !== 'cost_basis_unavailable' && pnlReason !== 'history_incomplete' && pnlReason !== 'price_unavailable') return invalid();
  return {
    totalValueUsd: nullableDecimal(data.totalValueUsd), pricedValueUsd: decimal(data.pricedValueUsd), change24hUsd: nullableDecimal(data.change24hUsd), change24hPercent: nullableDecimal(data.change24hPercent), historicalChange24hUsd: nullableDecimal(data.historicalChange24hUsd), historicalChange24hPercent: nullableDecimal(data.historicalChange24hPercent), bestAsset: performance(data.bestAsset), worstAsset: performance(data.worstAsset),
    allocation: array(data.allocation, (item) => { const row = object(item); return { assetKey: string(row.assetKey), symbol: string(row.symbol), valueUsd: decimal(row.valueUsd), percentage: decimal(row.percentage) }; }),
    pricedAssetCount: integer(data.pricedAssetCount), unpricedAssetCount: integer(data.unpricedAssetCount), complete: boolean(data.complete), marketChangeComplete: boolean(data.marketChangeComplete), allocationBasis: 'priced_assets', pnlAvailable: data.pnlAvailable, pnlReason,
  };
}
export function decodePrice(value: unknown): AssetPriceResponse {
  const data = object(value);
  if (data.availability !== 'available' && data.availability !== 'unavailable') return invalid();
  const price = nullableDecimal(data.priceUsd);
  if ((data.availability === 'available') !== (price !== null)) return invalid();
  return { assetKey: string(data.assetKey), tokenAddress: nullableString(data.tokenAddress), coinGeckoId: nullableString(data.coinGeckoId), symbol: nullableString(data.symbol), priceUsd: price, change24hPercent: nullableDecimal(data.change24hPercent), marketCapUsd: nullableDecimal(data.marketCapUsd), fetchedAt: nullableTimestamp(data.fetchedAt), availability: data.availability, stale: boolean(data.stale) };
}
export function decodeWatchlist(value: unknown): WatchlistResponse {
  const data = object(value);
  return { id: string(data.id), name: string(data.name), createdAt: timestamp(data.createdAt) };
}
export function decodeWatchlistItem(value: unknown): WatchlistItemResponse {
  const data = object(value);
  if (data.itemType !== 'address' && data.itemType !== 'token') return invalid();
  return { id: string(data.id), watchlistId: string(data.watchlistId), itemType: data.itemType, address: string(data.address), label: nullableString(data.label), createdAt: timestamp(data.createdAt) };
}
export function decodeWatchlistDetail(value: unknown): WatchlistDetailResponse {
  const data = object(value);
  return { ...decodeWatchlist(data), items: array(data.items, decodeWatchlistItem) };
}
export function decodeWatchlistList(value: unknown): WatchlistListResponse { return page(value, decodeWatchlist); }
export function isAlertType(value: string): value is AlertType { return value === 'whale' || value === 'price_above' || value === 'price_below' || value === 'wallet_activity'; }
export function decodeAlert(value: unknown): AlertResponse {
  const data = object(value);
  const type = string(data.type);
  if (!isAlertType(type)) return invalid();
  return { id: string(data.id), type, enabled: boolean(data.enabled), walletAddress: nullableString(data.walletAddress), tokenAddress: nullableString(data.tokenAddress), thresholdUsd: nullableDecimal(data.thresholdUsd), createdAt: timestamp(data.createdAt), updatedAt: timestamp(data.updatedAt) };
}
export function decodeAlertEvent(value: unknown): AlertEventResponse {
  const data = object(value);
  return { id: string(data.id), alertId: string(data.alertId), title: string(data.title), message: nullableString(data.message), payload: data.payload, triggeredAt: timestamp(data.triggeredAt), readAt: nullableTimestamp(data.readAt) };
}
export function decodeAlertList(value: unknown): AlertListResponse { return page(value, decodeAlert); }
export function decodeAlertEventList(value: unknown): AlertEventListResponse { return page(value, decodeAlertEvent); }
export function decodeVoid(value: unknown): void { if (value !== undefined && value !== null) invalid(); }
