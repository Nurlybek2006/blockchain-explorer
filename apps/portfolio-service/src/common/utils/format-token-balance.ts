/** Convert integer base units to an exact decimal string without floating point. */
export function formatTokenBalance(balanceRaw: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError('Token decimals must be between 0 and 255');
  }
  if (!/^\d+$/.test(balanceRaw)) {
    throw new TypeError('Token balance must be a non-negative integer string');
  }

  const normalized = balanceRaw.replace(/^0+(?=\d)/, '');
  if (decimals === 0) {
    return normalized;
  }

  const padded = normalized.padStart(decimals + 1, '0');
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction.length > 0 ? `${integer}.${fraction}` : integer;
}
