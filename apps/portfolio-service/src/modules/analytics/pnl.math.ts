import type { PortfolioAssetPnl, PortfolioPnlReason, PortfolioPnlResponse, PortfolioTradeInput, PortfolioValuationResponse } from '@blockchain-explorer/contracts';
import { FinanceDecimal, toMoney } from '../../common/utils/decimal-math.js';

export interface OrderedTrade extends PortfolioTradeInput { sequence: bigint }
interface Position {
  assetKey: string; symbol: string; decimals: number; quantityRaw: bigint;
  cost: InstanceType<typeof FinanceDecimal>; disposedCost: InstanceType<typeof FinanceDecimal>; realized: InstanceType<typeof FinanceDecimal>;
}
export class TradeHistoryError extends Error {}

/** Replay at full precision. Sales remove weighted average cost; transfers never realize gains. */
export function replayTrades(entries: readonly OrderedTrade[]): Map<string, Position> {
  const positions = new Map<string, Position>();
  const ordered = [...entries].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    || (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  for (const entry of ordered) {
    let position = positions.get(entry.assetKey);
    if (!position) {
      position = { assetKey: entry.assetKey, symbol: entry.symbol, decimals: entry.decimals, quantityRaw: 0n,
        cost: new FinanceDecimal(0), disposedCost: new FinanceDecimal(0), realized: new FinanceDecimal(0) };
      positions.set(entry.assetKey, position);
    }
    if (position.decimals !== entry.decimals) throw new TradeHistoryError('Inconsistent asset decimals');
    const raw = BigInt(entry.quantityRaw);
    const quantity = new FinanceDecimal(entry.quantityRaw).div(new FinanceDecimal(10).pow(entry.decimals));
    const fee = new FinanceDecimal(entry.feeUsd);
    if (entry.side === 'buy' || entry.side === 'transfer_in') {
      if (entry.unitPriceUsd === null) throw new TradeHistoryError('Missing acquisition cost');
      position.quantityRaw += raw;
      position.cost = position.cost.add(quantity.mul(entry.unitPriceUsd)).add(fee);
    } else {
      if (raw > position.quantityRaw) throw new TradeHistoryError('Disposal exceeds earlier acquired quantity');
      const removed = raw === position.quantityRaw ? position.cost : position.cost.mul(raw.toString()).div(position.quantityRaw.toString());
      position.quantityRaw -= raw;
      position.cost = position.cost.sub(removed);
      if (entry.side === 'sell') {
        if (entry.unitPriceUsd === null) throw new TradeHistoryError('Missing sale price');
        position.disposedCost = position.disposedCost.add(removed);
        position.realized = position.realized.add(quantity.mul(entry.unitPriceUsd).sub(fee).sub(removed));
      } else if (entry.side === 'fee') {
        position.disposedCost = position.disposedCost.add(removed);
        position.realized = position.realized.sub(removed);
      }
    }
  }
  return positions;
}

export function buildPnl(valuation: PortfolioValuationResponse, entries: readonly OrderedTrade[], asOf = new Date()): PortfolioPnlResponse {
  const positions = replayTrades(entries);
  const holdings = new Map(valuation.holdings.map(h => [h.assetKey, h]));
  const keys = new Set([...positions.keys(), ...holdings.keys(), 'native:eth']);
  const sum = { cost: new FinanceDecimal(0), disposed: new FinanceDecimal(0), current: new FinanceDecimal(0), realized: new FinanceDecimal(0), unrealized: new FinanceDecimal(0) };
  let basisComplete = entries.length > 0, pricesComplete = true;
  const assets: PortfolioAssetPnl[] = [...keys].sort().map(assetKey => {
    const holding = holdings.get(assetKey), position = positions.get(assetKey);
    const reasons: PortfolioPnlReason[] = [];
    const observed = holding !== undefined && holding.lastUpdatedBlock !== null;
    const ledgerRaw = position?.quantityRaw ?? 0n;
    if (!observed) reasons.push('balance_unobserved');
    else if (!position && BigInt(holding.balanceRaw) !== 0n) reasons.push('history_missing');
    else if (ledgerRaw !== BigInt(holding.balanceRaw) || (position && position.decimals !== holding.decimals)) reasons.push('balance_mismatch');
    if (!entries.length && !reasons.includes('history_missing')) reasons.push('history_missing');
    const basisKnown = reasons.length === 0;
    if (!basisKnown) basisComplete = false;
    const raw = holding?.balanceRaw ?? null;
    const decimals = holding?.decimals ?? position?.decimals ?? 18;
    const quantity = raw === null ? null : new FinanceDecimal(raw).div(new FinanceDecimal(10).pow(decimals));
    const price = holding?.priceUsd ?? null;
    if (quantity !== null && !quantity.isZero()) {
      if (price === null) reasons.push('price_unavailable');
      else if (holding?.priceStale) reasons.push('stale_price');
    }
    const current = quantity?.isZero() ? new FinanceDecimal(0)
      : quantity !== null && price !== null && !holding?.priceStale ? quantity.mul(price) : null;
    if (current === null) pricesComplete = false;
    const cost = position?.cost ?? new FinanceDecimal(0), realized = position?.realized ?? new FinanceDecimal(0), disposed = position?.disposedCost ?? new FinanceDecimal(0);
    const unrealized = basisKnown && current !== null ? current.sub(cost) : null;
    const total = unrealized === null ? null : unrealized.add(realized);
    const capital = cost.add(disposed);
    if (basisKnown) { sum.cost = sum.cost.add(cost); sum.disposed = sum.disposed.add(disposed); sum.realized = sum.realized.add(realized); }
    if (current !== null) sum.current = sum.current.add(current);
    if (unrealized !== null) sum.unrealized = sum.unrealized.add(unrealized);
    return { assetKey, symbol: holding?.symbol ?? position?.symbol ?? 'ETH', decimals, balanceRaw: raw, ledgerBalanceRaw: ledgerRaw.toString(),
      averageEntryPriceUsd: basisKnown && ledgerRaw > 0n ? toMoney(cost.mul(new FinanceDecimal(10).pow(decimals)).div(ledgerRaw.toString())) : null,
      costBasisUsd: basisKnown ? toMoney(cost) : null, disposedCostBasisUsd: basisKnown ? toMoney(disposed) : null,
      priceUsd: price, currentValueUsd: current === null ? null : toMoney(current), realizedPnlUsd: basisKnown ? toMoney(realized) : null,
      unrealizedPnlUsd: unrealized === null ? null : toMoney(unrealized), totalPnlUsd: total === null ? null : toMoney(total),
      roiPercent: total !== null && !capital.isZero() ? toMoney(total.div(capital).mul(100)) : null,
      unrealizedRoiPercent: unrealized !== null && !cost.isZero() ? toMoney(unrealized.div(cost).mul(100)) : null,
      complete: reasons.length === 0, reasons };
  });
  const complete = basisComplete && pricesComplete && valuation.summary.complete, capital = sum.cost.add(sum.disposed), total = sum.realized.add(sum.unrealized);
  return { method: 'moving_average', asOf: asOf.toISOString(), entryCount: entries.length, assets,
    summary: { investedUsd: basisComplete ? toMoney(sum.cost) : null, capitalBasisUsd: basisComplete ? toMoney(capital) : null,
      currentValueUsd: pricesComplete && valuation.summary.complete ? toMoney(sum.current) : null,
      realizedPnlUsd: basisComplete ? toMoney(sum.realized) : null, unrealizedPnlUsd: complete ? toMoney(sum.unrealized) : null,
      totalPnlUsd: complete ? toMoney(total) : null, roiPercent: complete && !capital.isZero() ? toMoney(total.div(capital).mul(100)) : null, complete } };
}
