import { describe, expect, it } from 'vitest';
import { formatBigInteger, formatDateTime, formatGas, formatPercentage, formatRelativeTime, formatTokenAmount, formatUsd } from './index';
describe('financial display precision', () => {
  it('groups USD larger than the safe integer range without converting it to Number', () => { expect(formatUsd('900719925474099312345.125')).toBe('$900,719,925,474,099,312,345.13'); });
  it('distinguishes unavailable USD from actual zero', () => { expect(formatUsd(null)).toBe('—'); expect(formatUsd('0')).toBe('$0.00'); });
  it('retains the sign of negative money', () => { expect(formatUsd('-1234.567')).toBe('-$1,234.57'); });
  it('shows nonzero sub-cent prices as sub-cent values', () => { expect(formatUsd('0.000000000000000001')).toBe('<$0.01'); });
  it('formats uint256 balances with integer precision', () => { expect(formatTokenAmount('900719925474099300000000000000000001', 18)).toBe('900,719,925,474,099,300.000000'); });
  it('shows a tiny nonzero token quantity without inventing zero', () => { expect(formatTokenAmount('1', 18)).toBe('<0.000001'); });
  it('handles zero-decimal tokens and rejects malformed amounts', () => { expect(formatTokenAmount('123456', 0)).toBe('123,456'); expect(formatTokenAmount('1e18', 18)).toBe('—'); });
  it('rejects unsafe already-rounded numeric input', () => { expect(formatBigInteger(9007199254740992)).toBe('—'); expect(formatGas('30000000')).toBe('30,000,000'); });
  it('formats market changes including unavailable and rounded zero', () => { expect(formatPercentage('2.345')).toBe('+2.35%'); expect(formatPercentage('-0.0001')).toBe('0.00%'); expect(formatPercentage(null)).toBe('—'); });
  it('formats timestamp consistently in UTC and rejects invalid timestamps', () => { expect(formatDateTime('2026-10-14T12:00:00Z')).toContain('12:00:00 UTC'); expect(formatDateTime('bad')).toBe('—'); });
  it('uses a bounded nonnegative relative time', () => { expect(formatRelativeTime('2026-10-14T00:00:00Z', Date.parse('2026-10-14T01:00:00Z'))).toBe('1 hour ago'); });
});
