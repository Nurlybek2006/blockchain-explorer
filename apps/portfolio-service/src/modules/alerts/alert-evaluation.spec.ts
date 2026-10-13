import { describe, expect, it } from 'vitest';
import { crossingDecision, priceCondition, transferUsdValue } from './alert-evaluation.js';

describe('Durable price crossing decisions', () => {
  const previous = new Date('2026-10-14T00:00:00Z');
  const newer = new Date('2026-10-14T00:01:00Z');

  it('records the first observation without triggering an initial crossing', () => {
    expect(crossingDecision(null, null, previous, true)).toEqual({ update: true, trigger: false });
    expect(crossingDecision(null, null, previous, false)).toEqual({ update: true, trigger: false });
  });

  it('triggers only false-to-true and permits a later recrossing', () => {
    expect(crossingDecision(false, previous, newer, true)).toEqual({ update: true, trigger: true });
    expect(crossingDecision(true, previous, newer, true)).toEqual({ update: true, trigger: false });
    expect(crossingDecision(true, previous, newer, false)).toEqual({ update: true, trigger: false });
    expect(crossingDecision(false, previous, newer, false)).toEqual({ update: true, trigger: false });
  });

  it('does not mutate persisted state for stale, duplicate or out-of-order samples', () => {
    expect(crossingDecision(false, newer, previous, true)).toEqual({ update: false, trigger: false });
    expect(crossingDecision(false, previous, previous, true)).toEqual({ update: false, trigger: false });
  });

  it('uses exact decimal comparisons with strict above/below thresholds', () => {
    expect(priceCondition('price_above', '100.000000000000000001', '100')).toBe(true);
    expect(priceCondition('price_above', '100', '100')).toBe(false);
    expect(priceCondition('price_below', '99.999999999999999999', '100')).toBe(true);
    expect(priceCondition('price_below', '100', '100')).toBe(false);
  });
});

describe('Whale transfer precision', () => {
  it('preserves uint256 and token decimal precision before threshold comparison', () => {
    const value = transferUsdValue('100000000000000000000001', 18, '1');
    expect(value.toFixed(18)).toBe('100000.000000000000000001');
    expect(value.gt('100000')).toBe(true);
    const huge = transferUsdValue('1234567890123456789012345678901234567890', 6, '1.123456789012345678');
    expect(huge.toFixed(18)).toBe('1386983677655845155404663935540466.393553907940987639');
  });

  it('does not treat an invalid raw amount or decimals as zero', () => {
    expect(() => transferUsdValue('not-a-number', 18, '1')).toThrow();
    expect(() => transferUsdValue('1', 256, '1')).toThrow();
    expect(() => transferUsdValue('1', 18, '-1')).toThrow();
  });
});
