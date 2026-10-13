import { describe, expect, it } from 'vitest';
import { formatTokenBalance } from './format-token-balance.js';

describe('formatTokenBalance', () => {
  it('preserves all digits above JavaScript integer precision', () => {
    expect(formatTokenBalance('123456789012345678901234567890123456789', 18))
      .toBe('123456789012345678901.234567890123456789');
  });

  it('formats native ETH base units and leading/trailing zeroes exactly', () => {
    expect(formatTokenBalance('1', 18)).toBe('0.000000000000000001');
    expect(formatTokenBalance('1234500000000000000', 18)).toBe('1.2345');
    expect(formatTokenBalance('0001000000', 6)).toBe('1');
    expect(formatTokenBalance('0', 18)).toBe('0');
    expect(formatTokenBalance('00042', 0)).toBe('42');
  });

  it('supports the complete ERC-20 decimals range', () => {
    expect(formatTokenBalance('1', 255)).toBe(`0.${'0'.repeat(254)}1`);
    expect(formatTokenBalance('9'.repeat(78), 0)).toBe('9'.repeat(78));
  });

  it('rejects fractional, negative, exponential and invalid decimal inputs', () => {
    for (const raw of ['1.5', '-1', '1e18', '', ' 42']) {
      expect(() => formatTokenBalance(raw, 18)).toThrow(TypeError);
    }
    for (const decimals of [-1, 0.5, 256, NaN]) {
      expect(() => formatTokenBalance('1', decimals)).toThrow(RangeError);
    }
  });
});
