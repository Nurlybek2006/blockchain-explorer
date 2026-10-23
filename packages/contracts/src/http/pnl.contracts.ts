import { isAssetKey } from '../utils/asset-key.js';

export const TRADE_SIDES = ['buy', 'sell', 'transfer_in', 'transfer_out', 'fee'] as const;
export type PortfolioTradeSide = typeof TRADE_SIDES[number];
export interface PortfolioTradeInput {
  clientId: string;
  assetKey: string;
  symbol: string;
  decimals: number;
  side: PortfolioTradeSide;
  quantityRaw: string;
  unitPriceUsd: string | null;
  feeUsd: string;
  occurredAt: string;
  transactionHash: string | null;
  activityId: string | null;
}
export interface PortfolioTradeResponse extends PortfolioTradeInput { id: string; sequence: string }
export interface PortfolioTradeListResponse { items: PortfolioTradeResponse[]; total: number; page: number; limit: number; totalPages: number }
export const PNL_REASONS = ['history_missing', 'balance_mismatch', 'balance_unobserved', 'price_unavailable', 'stale_price'] as const;
export type PortfolioPnlReason = typeof PNL_REASONS[number];
export interface PortfolioAssetPnl {
  assetKey: string;
  symbol: string;
  decimals: number;
  balanceRaw: string | null;
  ledgerBalanceRaw: string;
  averageEntryPriceUsd: string | null;
  costBasisUsd: string | null;
  disposedCostBasisUsd: string | null;
  priceUsd: string | null;
  currentValueUsd: string | null;
  realizedPnlUsd: string | null;
  unrealizedPnlUsd: string | null;
  totalPnlUsd: string | null;
  roiPercent: string | null;
  unrealizedRoiPercent: string | null;
  complete: boolean;
  reasons: PortfolioPnlReason[];
}
export interface PortfolioPnlResponse {
  method: 'moving_average';
  asOf: string;
  entryCount: number;
  summary: {
    investedUsd: string | null;
    capitalBasisUsd: string | null;
    currentValueUsd: string | null;
    realizedPnlUsd: string | null;
    unrealizedPnlUsd: string | null;
    totalPnlUsd: string | null;
    roiPercent: string | null;
    complete: boolean;
  };
  assets: PortfolioAssetPnl[];
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const usd = /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/;
const uint256 = (1n << 256n) - 1n;
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function isPortfolioTradeSide(value: unknown): value is PortfolioTradeSide { return TRADE_SIDES.some(side => side === value); }
export function isPortfolioTradeInput(value: unknown): value is PortfolioTradeInput {
  if (!record(value) || typeof value.clientId !== 'string' || !uuid.test(value.clientId)
    || !isAssetKey(value.assetKey) || typeof value.symbol !== 'string' || !value.symbol.trim() || value.symbol.length > 64
    || typeof value.decimals !== 'number' || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 255
    || (value.assetKey === 'native:eth' && (value.decimals !== 18 || value.symbol !== 'ETH'))
    || !isPortfolioTradeSide(value.side) || typeof value.quantityRaw !== 'string' || !/^[1-9]\d{0,77}$/.test(value.quantityRaw)
    || BigInt(value.quantityRaw) > uint256 || typeof value.feeUsd !== 'string' || !usd.test(value.feeUsd)
    || typeof value.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.occurredAt)
    || !Number.isFinite(Date.parse(value.occurredAt)) || new Date(value.occurredAt).toISOString().slice(0, 19) !== value.occurredAt.slice(0, 19)
    || (value.transactionHash !== null && (typeof value.transactionHash !== 'string' || !/^0x[\da-f]{64}$/.test(value.transactionHash)))
    || (value.activityId !== null && (typeof value.activityId !== 'string' || !value.activityId.trim() || value.activityId.length > 200))
    || (value.activityId !== null && value.transactionHash === null)) return false;
  return value.side === 'transfer_out' || value.side === 'fee' ? value.unitPriceUsd === null && !/[1-9]/.test(value.feeUsd)
    : typeof value.unitPriceUsd === 'string' && usd.test(value.unitPriceUsd);
}

/** Decimal input becomes exact token units; no floating-point conversion. */
export function tradeQuantityRaw(value: string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^\d{1,78}(?:\.\d{1,255})?$/.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  if (integer === undefined || fraction.length > decimals) return null;
  const raw = BigInt(integer + fraction.padEnd(decimals, '0'));
  return raw > 0n && raw <= uint256 ? raw.toString() : null;
}

function invalid(): never { throw new Error('Invalid portfolio P&L response'); }
function object(value: unknown): Record<string, unknown> { if (!record(value)) return invalid(); return value; }
function amount(value: unknown, signed = false): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 700 || !(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value)) return invalid();
  return value;
}
function number(value: unknown, max = 10_000): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid(); return value; }
export function decodePortfolioTrade(value: unknown): PortfolioTradeResponse {
  if (!isPortfolioTradeInput(value) || !record(value) || typeof value.id !== 'string' || !uuid.test(value.id)
    || typeof value.sequence !== 'string' || !/^[1-9]\d{0,19}$/.test(value.sequence)) return invalid();
  return { clientId: value.clientId, assetKey: value.assetKey, symbol: value.symbol, decimals: value.decimals,
    side: value.side, quantityRaw: value.quantityRaw, unitPriceUsd: value.unitPriceUsd, feeUsd: value.feeUsd,
    occurredAt: value.occurredAt, transactionHash: value.transactionHash, activityId: value.activityId, id: value.id, sequence: value.sequence };
}
export function decodePortfolioTrades(value: unknown): PortfolioTradeListResponse {
  const b = object(value);
  const total = number(b.total), page = number(b.page, 1_000_000), limit = number(b.limit, 100), totalPages = number(b.totalPages);
  if (!page || !limit || !Array.isArray(b.items) || b.items.length > limit || totalPages !== Math.ceil(total / limit)) return invalid();
  return { items: b.items.map(decodePortfolioTrade), total, page, limit, totalPages };
}
export function decodePortfolioPnl(value: unknown): PortfolioPnlResponse {
  const b = object(value), s = object(b.summary);
  if (b.method !== 'moving_average' || typeof b.asOf !== 'string' || !Number.isFinite(Date.parse(b.asOf))
    || !Array.isArray(b.assets) || b.assets.length > 10_001 || typeof s.complete !== 'boolean') return invalid();
  const assets = b.assets.map((value): PortfolioAssetPnl => {
    const a = object(value);
    if (!isAssetKey(a.assetKey) || typeof a.symbol !== 'string' || a.symbol.length > 64 || typeof a.complete !== 'boolean'
      || !Array.isArray(a.reasons) || !a.reasons.every((reason): reason is PortfolioPnlReason => PNL_REASONS.some(known => known === reason))
      || a.complete !== (a.reasons.length === 0)) return invalid();
    const decimals = number(a.decimals, 255), balanceRaw = amount(a.balanceRaw), ledgerBalanceRaw = amount(a.ledgerBalanceRaw);
    if (ledgerBalanceRaw === null || !/^\d+$/.test(ledgerBalanceRaw) || (balanceRaw !== null && !/^\d+$/.test(balanceRaw))) return invalid();
    const asset = { assetKey: a.assetKey, symbol: a.symbol, decimals, balanceRaw, ledgerBalanceRaw,
      averageEntryPriceUsd: amount(a.averageEntryPriceUsd), costBasisUsd: amount(a.costBasisUsd), disposedCostBasisUsd: amount(a.disposedCostBasisUsd),
      priceUsd: amount(a.priceUsd), currentValueUsd: amount(a.currentValueUsd), realizedPnlUsd: amount(a.realizedPnlUsd, true),
      unrealizedPnlUsd: amount(a.unrealizedPnlUsd, true), totalPnlUsd: amount(a.totalPnlUsd, true), roiPercent: amount(a.roiPercent, true),
      unrealizedRoiPercent: amount(a.unrealizedRoiPercent, true), complete: a.complete, reasons: a.reasons };
    if (asset.complete && [asset.costBasisUsd, asset.disposedCostBasisUsd, asset.currentValueUsd, asset.realizedPnlUsd, asset.unrealizedPnlUsd, asset.totalPnlUsd].some(v => v === null)) return invalid();
    return asset;
  });
  if (new Set(assets.map(a => a.assetKey)).size !== assets.length || (s.complete && assets.some(a => !a.complete))) return invalid();
  const summary = { investedUsd: amount(s.investedUsd), capitalBasisUsd: amount(s.capitalBasisUsd), currentValueUsd: amount(s.currentValueUsd),
    realizedPnlUsd: amount(s.realizedPnlUsd, true), unrealizedPnlUsd: amount(s.unrealizedPnlUsd, true), totalPnlUsd: amount(s.totalPnlUsd, true),
    roiPercent: amount(s.roiPercent, true), complete: s.complete };
  if (s.complete && [summary.investedUsd, summary.capitalBasisUsd, summary.currentValueUsd, summary.realizedPnlUsd, summary.unrealizedPnlUsd, summary.totalPnlUsd].some(v => v === null)) return invalid();
  return { method: 'moving_average', asOf: b.asOf, entryCount: number(b.entryCount), summary, assets };
}
