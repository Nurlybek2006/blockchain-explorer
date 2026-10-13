import type { AlertType, TokenTransferIndexedEvent } from '@blockchain-explorer/contracts';
import { FinanceDecimal } from '../../common/utils/decimal-math.js';

export interface AlertSettings {
  type: AlertType;
  enabled: boolean;
  walletAddress: string | null;
  tokenAddress: string | null;
  thresholdUsd: string | null;
}

export function isAlertType(value: string): value is AlertType {
  return value === 'whale' || value === 'price_above' || value === 'price_below' || value === 'wallet_activity';
}

export function priceCondition(type: string, priceUsd: string, thresholdUsd: string): boolean {
  const price = new FinanceDecimal(priceUsd);
  const threshold = new FinanceDecimal(thresholdUsd);
  if (!price.isFinite() || price.isNegative() || !threshold.isFinite() || !threshold.isPositive()) {
    throw new Error('Invalid alert price or threshold');
  }
  if (type === 'price_above') return price.gt(threshold);
  if (type === 'price_below') return price.lt(threshold);
  throw new Error('Invalid price alert type');
}

export function crossingDecision(
  lastConditionMet: boolean | null,
  lastEvaluatedAt: Date | null,
  fetchedAt: Date,
  conditionMet: boolean,
): { update: boolean; trigger: boolean } {
  if (lastEvaluatedAt !== null && fetchedAt.getTime() <= lastEvaluatedAt.getTime()) {
    return { update: false, trigger: false };
  }
  return { update: true, trigger: lastConditionMet === false && conditionMet };
}

export function transferMatches(
  rule: Pick<AlertSettings, 'enabled' | 'type' | 'walletAddress' | 'tokenAddress'>,
  event: TokenTransferIndexedEvent,
): boolean {
  if (!rule.enabled || (rule.type !== 'whale' && rule.type !== 'wallet_activity')) return false;
  const payload = event.payload;
  if (rule.tokenAddress !== null && rule.tokenAddress.toLowerCase() !== payload.tokenAddress.toLowerCase()) return false;
  if (rule.type === 'wallet_activity' && rule.walletAddress === null) return false;
  return rule.walletAddress === null
    || rule.walletAddress.toLowerCase() === payload.fromAddress.toLowerCase()
    || rule.walletAddress.toLowerCase() === payload.toAddress.toLowerCase();
}

export function transferUsdValue(amountRaw: string, decimals: number, priceUsd: string) {
  if (!/^\d+$/.test(amountRaw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Invalid transfer amount or token decimals');
  }
  const price = new FinanceDecimal(priceUsd);
  if (!price.isFinite() || price.isNegative()) throw new Error('Invalid transfer price');
  return new FinanceDecimal(amountRaw).div(new FinanceDecimal(10).pow(decimals)).mul(price);
}
