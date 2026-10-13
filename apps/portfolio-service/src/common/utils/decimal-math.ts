import { Decimal } from 'decimal.js';

// uint256 balances and numeric(78,18) prices must not share Decimal's default
// 20-digit precision or a mutable global constructor configuration.
export const FinanceDecimal = Decimal.clone({
  precision: 160,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1000,
  toExpPos: 1000,
});

export function toMoney(value: Decimal.Value, scale = 18): string {
  const decimal = new FinanceDecimal(value);
  if (!decimal.isFinite() || !Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error('Invalid monetary value or scale');
  }
  const formatted = decimal.toFixed(scale);
  if (new FinanceDecimal(formatted).isZero()) return '0';
  return formatted.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
