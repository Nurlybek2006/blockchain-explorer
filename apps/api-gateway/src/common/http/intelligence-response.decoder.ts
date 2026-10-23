import { isAssetKey, isEthereumAddress } from '@blockchain-explorer/contracts';
import type { AlertEventResponse, AlertResponse, AssetPriceResponse, PaginatedResponse, PortfolioAnalyticsResponse, PortfolioAssetPerformance, PortfolioHistoryResponse, PortfolioValuationResponse, WatchlistDetailResponse, WatchlistItemResponse, WatchlistResponse } from '@blockchain-explorer/contracts';
import { decodeHolding, decodePortfolio } from '../../modules/portfolio/portfolio-response.decoder.js';
import { decodeValuationSummary, invalidResponse, readBoolean, readDecimal, readInteger, readMoney, readNullableString, readNullableTimestamp, readRecord, readString, readTimestamp, readUuid } from './response-fields.js';

function nullableAddress(value: unknown): string | null {
  if (value === null) return null;
  if (!isEthereumAddress(value)) return invalidResponse();
  return value;
}
export function decodePrice(value: unknown): AssetPriceResponse {
  const b = readRecord(value);
  if (!isAssetKey(b.assetKey) || (b.availability !== 'available' && b.availability !== 'unavailable')) return invalidResponse();
  const priceUsd = readDecimal(b.priceUsd, true, false); const fetchedAt = readNullableTimestamp(b.fetchedAt);
  if ((b.availability === 'available' && (priceUsd === null || fetchedAt === null)) || (b.availability === 'unavailable' && priceUsd !== null)) return invalidResponse();
  return { assetKey: b.assetKey, availability: b.availability, tokenAddress: nullableAddress(b.tokenAddress), coinGeckoId: readNullableString(b.coinGeckoId), symbol: readNullableString(b.symbol), priceUsd, change24hPercent: readDecimal(b.change24hPercent), marketCapUsd: readDecimal(b.marketCapUsd, true, false), fetchedAt, stale: readBoolean(b.stale) };
}
export function decodeValuation(value: unknown): PortfolioValuationResponse {
  const b = readRecord(value);
  if (!Array.isArray(b.holdings)) return invalidResponse();
  return { portfolio: decodePortfolio(b.portfolio), summary: decodeValuationSummary(b.summary), holdings: b.holdings.map((value: unknown) => {
    const h = readRecord(value);
    return { ...decodeHolding(h), priceUsd: readDecimal(h.priceUsd, true, false), valueUsd: readDecimal(h.valueUsd, true, false), change24hPercent: readDecimal(h.change24hPercent), priceFetchedAt: readNullableTimestamp(h.priceFetchedAt), priceStale: readBoolean(h.priceStale) };
  }) };
}
export function decodeHistory(value: unknown): PortfolioHistoryResponse {
  const b = readRecord(value);
  if (b.range !== '24h' && b.range !== '7d' && b.range !== '30d' && b.range !== '90d') return invalidResponse();
  if (!Array.isArray(b.points)) return invalidResponse();
  return { range: b.range, points: b.points.map((value: unknown) => { const p = readRecord(value); return { timestamp: readTimestamp(p.timestamp), valueUsd: readMoney(p.valueUsd) }; }) };
}
function performance(value: unknown): PortfolioAssetPerformance | null {
  if (value === null) return null;
  const b = readRecord(value); const change24hPercent = readDecimal(b.change24hPercent, false);
  if (change24hPercent === null) return invalidResponse();
  return { assetKey: readString(b.assetKey), symbol: readString(b.symbol), change24hPercent };
}
export function decodeAnalytics(value: unknown): PortfolioAnalyticsResponse {
  const b = readRecord(value);
  if (!Array.isArray(b.allocation) || b.allocationBasis !== 'priced_assets' || typeof b.pnlAvailable !== 'boolean'
    || (b.pnlAvailable ? b.pnlReason !== null : !['cost_basis_unavailable', 'history_incomplete', 'price_unavailable'].includes(readString(b.pnlReason)))) return invalidResponse();
  const pnlReason = b.pnlReason;
  if (pnlReason !== null && pnlReason !== 'cost_basis_unavailable' && pnlReason !== 'history_incomplete' && pnlReason !== 'price_unavailable') return invalidResponse();
  return {
    totalValueUsd: readDecimal(b.totalValueUsd, true, false), pricedValueUsd: readMoney(b.pricedValueUsd), change24hUsd: readDecimal(b.change24hUsd), change24hPercent: readDecimal(b.change24hPercent), historicalChange24hUsd: readDecimal(b.historicalChange24hUsd), historicalChange24hPercent: readDecimal(b.historicalChange24hPercent),
    bestAsset: performance(b.bestAsset), worstAsset: performance(b.worstAsset), allocation: b.allocation.map((value: unknown) => { const a = readRecord(value); return { assetKey: readString(a.assetKey), symbol: readString(a.symbol), valueUsd: readMoney(a.valueUsd), percentage: readMoney(a.percentage) }; }),
    pricedAssetCount: readInteger(b.pricedAssetCount), unpricedAssetCount: readInteger(b.unpricedAssetCount), complete: readBoolean(b.complete), marketChangeComplete: readBoolean(b.marketChangeComplete), allocationBasis: 'priced_assets', pnlAvailable: b.pnlAvailable, pnlReason,
  };
}
export function decodeWatchlist(value: unknown): WatchlistResponse { const b = readRecord(value); return { id: readUuid(b.id), name: readString(b.name), createdAt: readTimestamp(b.createdAt) }; }
export function decodeWatchlistItem(value: unknown): WatchlistItemResponse {
  const b = readRecord(value);
  if ((b.itemType !== 'address' && b.itemType !== 'token') || !isEthereumAddress(b.address)) return invalidResponse();
  return { id: readUuid(b.id), watchlistId: readUuid(b.watchlistId), itemType: b.itemType, address: b.address, label: readNullableString(b.label), createdAt: readTimestamp(b.createdAt) };
}
export function decodeWatchlistDetail(value: unknown): WatchlistDetailResponse { const b = readRecord(value); if (!Array.isArray(b.items)) return invalidResponse(); return { ...decodeWatchlist(b), items: b.items.map((item: unknown) => decodeWatchlistItem(item)) }; }
export function decodeAlert(value: unknown): AlertResponse {
  const b = readRecord(value);
  if (b.type !== 'whale' && b.type !== 'price_above' && b.type !== 'price_below' && b.type !== 'wallet_activity') return invalidResponse();
  return { id: readUuid(b.id), type: b.type, enabled: readBoolean(b.enabled), walletAddress: nullableAddress(b.walletAddress), tokenAddress: nullableAddress(b.tokenAddress), thresholdUsd: readDecimal(b.thresholdUsd, true, false), createdAt: readTimestamp(b.createdAt), updatedAt: readTimestamp(b.updatedAt) };
}
export function decodeAlertEvent(value: unknown): AlertEventResponse { const b = readRecord(value); return { id: readUuid(b.id), alertId: readUuid(b.alertId), title: readString(b.title), message: readNullableString(b.message), payload: b.payload, triggeredAt: readTimestamp(b.triggeredAt), readAt: readNullableTimestamp(b.readAt) }; }
export function decodePaginated<T>(value: unknown, decoder: (value: unknown) => T): PaginatedResponse<T> {
  const b = readRecord(value); if (!Array.isArray(b.items)) return invalidResponse();
  const page = readInteger(b.page, 1); const limit = readInteger(b.limit, 1, 100); const total = readInteger(b.total); const totalPages = readInteger(b.totalPages);
  if (totalPages !== Math.ceil(total / limit)) return invalidResponse();
  return { items: b.items.map((item: unknown) => decoder(item)), page, limit, total, totalPages };
}
