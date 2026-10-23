import type { AssetPriceResponse } from '@blockchain-explorer/contracts';
import type { AnalyticsHolding, PortfolioState } from './analytics.repository.js';
import type { PortfolioPnlResponse } from '@blockchain-explorer/contracts';

export function unavailablePnl(): PortfolioPnlResponse {
  return { method: 'moving_average', asOf: testDate.toISOString(), entryCount: 0, assets: [],
    summary: { investedUsd: null, capitalBasisUsd: null, currentValueUsd: null, realizedPnlUsd: null, unrealizedPnlUsd: null, totalPnlUsd: null, roiPercent: null, complete: false } };
}

export const testOwner = 'c9f0049a-3a4b-4e88-9f43-4c97b07ed634';
export const testPortfolioId = '3873f1cb-5630-4ce9-aa12-23cbdc623510';
export const testDate = new Date('2026-10-14T08:02:15.000Z');

export function holding(assetKey: string, balanceRaw: string, decimals = 18): AnalyticsHolding {
  return {
    id: testPortfolioId, portfolioId: testPortfolioId, assetKey, assetType: assetKey === 'native:eth' ? 'native' : 'erc20',
    tokenAddress: assetKey.startsWith('erc20:') ? assetKey.slice(6) : null,
    symbol: assetKey === 'native:eth' ? 'ETH' : assetKey, name: null, decimals,
    balanceRaw, lastUpdatedBlock: 9007199254740993n, updatedAt: testDate,
  };
}

export function state(items: AnalyticsHolding[]): PortfolioState {
  return { portfolio: {
    id: testPortfolioId, userId: testOwner, name: 'Main', walletAddress: `0x${'a'.repeat(40)}`,
    chainId: 11155111, isPrimary: true, archivedAt: null, createdAt: testDate, updatedAt: testDate,
  }, holdings: items };
}

export function price(assetKey: string, value: string | null, change: string | null = '0', stale = false): AssetPriceResponse {
  return {
    assetKey, tokenAddress: assetKey.startsWith('erc20:') ? assetKey.slice(6) : null,
    coinGeckoId: null, symbol: null, priceUsd: value, change24hPercent: change, marketCapUsd: null,
    fetchedAt: value === null ? null : testDate.toISOString(), availability: value === null ? 'unavailable' : 'available', stale,
  };
}
