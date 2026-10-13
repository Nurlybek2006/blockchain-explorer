import type {
  AssetPriceResponse, PortfolioAnalyticsResponse, PortfolioValuationResponse,
  PortfolioValuedHoldingResponse, PortfolioAssetPerformance,
} from '@blockchain-explorer/contracts';
import { FinanceDecimal, toMoney } from '../../common/utils/decimal-math.js';
import { formatTokenBalance } from '../../common/utils/format-token-balance.js';
import type { PortfolioState } from './analytics.repository.js';

function availablePrice(price: AssetPriceResponse | undefined): string | null {
  if (price?.availability !== 'available' || price.priceUsd === null) return null;
  const decimal = new FinanceDecimal(price.priceUsd);
  return decimal.isFinite() && !decimal.isNegative() ? price.priceUsd : null;
}

function validChange(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const decimal = new FinanceDecimal(value);
  return decimal.isFinite() && decimal.gte(-100) ? value : null;
}

export function buildValuation(state: PortfolioState, prices: ReadonlyMap<string, AssetPriceResponse>): PortfolioValuationResponse {
  let subtotal = new FinanceDecimal(0);
  let previous = new FinanceDecimal(0);
  let pricedAssetCount = 0;
  let staleAssetCount = 0;
  let complete = true;
  let marketChangeComplete = true;
  const valued: PortfolioValuedHoldingResponse[] = state.holdings.map((holding) => {
    const source = prices.get(holding.assetKey);
    const priceUsd = availablePrice(source);
    const balance = new FinanceDecimal(holding.balanceRaw).div(new FinanceDecimal(10).pow(holding.decimals));
    const change24hPercent = validChange(source?.change24hPercent);
    let valueUsd: string | null = balance.isZero() ? '0' : null;
    if (priceUsd !== null) {
      pricedAssetCount += 1;
      if (source?.stale) staleAssetCount += 1;
      const value = balance.mul(priceUsd);
      subtotal = subtotal.add(value);
      valueUsd = toMoney(value);
      if (!balance.isZero()) {
        if (change24hPercent === null || new FinanceDecimal(change24hPercent).lte(-100)) marketChangeComplete = false;
        else previous = previous.add(value.div(new FinanceDecimal(1).add(new FinanceDecimal(change24hPercent).div(100))));
      }
    } else if (!balance.isZero()) {
      complete = false;
      marketChangeComplete = false;
    }
    return {
      assetKey: holding.assetKey, assetType: holding.assetType, tokenAddress: holding.tokenAddress,
      symbol: holding.symbol, name: holding.name, decimals: holding.decimals, balanceRaw: holding.balanceRaw,
      balanceFormatted: formatTokenBalance(holding.balanceRaw, holding.decimals),
      lastUpdatedBlock: holding.lastUpdatedBlock?.toString() ?? null, updatedAt: holding.updatedAt.toISOString(),
      priceUsd, valueUsd, change24hPercent: priceUsd === null ? null : change24hPercent,
      priceFetchedAt: source?.fetchedAt ?? null, priceStale: source?.stale ?? false,
    };
  });
  const delta = subtotal.sub(previous);
  const portfolio = state.portfolio;
  return {
    portfolio: {
      id: portfolio.id, name: portfolio.name, walletAddress: portfolio.walletAddress, chainId: portfolio.chainId,
      isPrimary: portfolio.isPrimary, createdAt: portfolio.createdAt.toISOString(), updatedAt: portfolio.updatedAt.toISOString(),
    },
    holdings: valued,
    summary: {
      totalValueUsd: complete ? toMoney(subtotal) : null, pricedValueUsd: toMoney(subtotal),
      assetCount: valued.length, pricedAssetCount, unpricedAssetCount: valued.length - pricedAssetCount,
      complete, marketChangeComplete, staleAssetCount,
      change24hUsd: marketChangeComplete ? toMoney(delta) : null,
      change24hPercent: marketChangeComplete && !previous.isZero() ? toMoney(delta.div(previous).mul(100)) : null,
    },
  };
}

export function buildAnalytics(valuation: PortfolioValuationResponse, baselineValueUsd: string | null): PortfolioAnalyticsResponse {
  const summary = valuation.summary;
  const available = valuation.holdings.filter((holding) => holding.priceUsd !== null && holding.valueUsd !== null);
  const exactValue = (holding: PortfolioValuedHoldingResponse) => new FinanceDecimal(holding.balanceRaw)
    .div(new FinanceDecimal(10).pow(holding.decimals)).mul(holding.priceUsd ?? '0');
  const subtotal = available.reduce((total, holding) => total.add(exactValue(holding)), new FinanceDecimal(0));
  const performances: PortfolioAssetPerformance[] = available
    .filter((holding) => !new FinanceDecimal(holding.balanceRaw).isZero() && validChange(holding.change24hPercent) !== null)
    .flatMap((holding) => holding.change24hPercent === null ? [] : [{
      assetKey: holding.assetKey, symbol: holding.symbol, change24hPercent: holding.change24hPercent,
    }])
    .sort((left, right) => new FinanceDecimal(right.change24hPercent).cmp(left.change24hPercent) || left.assetKey.localeCompare(right.assetKey));
  const allocation = available.flatMap((holding) => holding.valueUsd === null ? [] : [{
    assetKey: holding.assetKey, symbol: holding.symbol, valueUsd: holding.valueUsd,
    percentage: subtotal.isZero() ? '0' : toMoney(exactValue(holding).div(subtotal).mul(100)),
  }]).sort((left, right) => new FinanceDecimal(right.valueUsd).cmp(left.valueUsd) || left.assetKey.localeCompare(right.assetKey));
  const historical = summary.totalValueUsd !== null && baselineValueUsd !== null
    ? new FinanceDecimal(summary.totalValueUsd).sub(baselineValueUsd) : null;
  const baseline = baselineValueUsd === null ? null : new FinanceDecimal(baselineValueUsd);
  return {
    totalValueUsd: summary.totalValueUsd, pricedValueUsd: summary.pricedValueUsd,
    change24hUsd: summary.change24hUsd, change24hPercent: summary.change24hPercent,
    historicalChange24hUsd: historical === null ? null : toMoney(historical),
    historicalChange24hPercent: historical !== null && baseline !== null && !baseline.isZero()
      ? toMoney(historical.div(baseline).mul(100)) : null,
    bestAsset: performances[0] ?? null, worstAsset: performances.at(-1) ?? null,
    allocation, pricedAssetCount: summary.pricedAssetCount, unpricedAssetCount: summary.unpricedAssetCount,
    complete: summary.complete, marketChangeComplete: summary.marketChangeComplete,
    allocationBasis: 'priced_assets', pnlAvailable: false, pnlReason: 'cost_basis_unavailable',
  };
}
