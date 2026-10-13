import { Decimal } from 'decimal.js';

const PriceDecimal = Decimal.clone({ precision: 100 });

/** Match the existing PostgreSQL numeric precision/scale before persisting. */
export function normalizePriceDecimal(value: unknown, precision: number, scale: number, signed = false): string | null {
  if (typeof value !== 'string' || value.length > 200 || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const decimal = new PriceDecimal(value);
  if (!decimal.isFinite() || (!signed && decimal.isNegative()) || decimal.e >= precision - scale || decimal.e < -500) return null;
  const rounded = decimal.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  // A positive unrepresentably small price must not become a fabricated zero.
  if (!decimal.isZero() && rounded.isZero()) return null;
  if (rounded.e >= precision - scale) return null;
  return rounded.toFixed();
}

export function isPlainDecimal(value: unknown, signed = false): value is string {
  return typeof value === 'string' && value.length <= 100 &&
    (signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(value);
}

export function isStoredDecimal(value: unknown, precision: number, scale: number, signed = false): value is string {
  if (!isPlainDecimal(value, signed)) return false;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  return integer.replace(/^0+/, '').length <= precision - scale && fraction.length <= scale;
}
