const unavailable = '—';
function decimalParts(value: string): { negative: boolean; integer: string; fraction: string } | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith('-'), [integer, fraction = ''] = value.replace(/^-/, '').split('.');
  return { negative, integer: integer.replace(/^0+(?=\d)/, ''), fraction };
}
function group(value: string): string { return value.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function rounded(value: string, digits: number): string {
  const parts = decimalParts(value); if (!parts) return unavailable;
  const fraction = parts.fraction.padEnd(digits + 1, '0');
  const scaled = BigInt(parts.integer + fraction.slice(0, digits)) + (Number(fraction[digits]) >= 5 ? 1n : 0n);
  const text = scaled.toString().padStart(digits + 1, '0');
  const integer = digits ? text.slice(0, -digits) : text;
  return `${parts.negative && scaled !== 0n ? '-' : ''}${group(integer)}${digits ? `.${text.slice(-digits)}` : ''}`;
}
export function formatUsd(value: string | null | undefined): string {
  if (value == null || !decimalParts(value)) return unavailable;
  const parts = decimalParts(value);
  if (parts && parts.integer === '0' && /[1-9]/.test(parts.fraction) && !/[1-9]/.test(parts.fraction.slice(0, 2))) return parts.negative ? '-<$0.01' : '<$0.01';
  const text = rounded(value, 2); return text.startsWith('-') ? `-$${text.slice(1)}` : `$${text}`;
}
export function formatPercentage(value: string | null | undefined): string {
  if (value == null || !decimalParts(value)) return unavailable; const text = rounded(value, 2);
  return `${!text.startsWith('-') && text !== '0.00' ? '+' : ''}${text}%`;
}
export function formatBigInteger(value: string | bigint | number | null | undefined): string {
  if (value == null) return unavailable;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return unavailable;
  const text = String(value); return /^-?\d+$/.test(text) ? group(text) : unavailable;
}
export const formatBlockNumber = formatBigInteger;
export const formatGas = formatBigInteger;
export function formatTokenAmount(raw: string, decimals: number, fractionDigits = 6): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return unavailable;
  const text = raw.replace(/^0+(?=\d)/, '').padStart(decimals + 1, '0');
  const integer = decimals ? text.slice(0, -decimals) : text;
  const fraction = decimals ? text.slice(-decimals).replace(/0+$/, '') : '';
  if (integer === '0' && fraction && !/[1-9]/.test(fraction.slice(0, fractionDigits))) return `<0.${'0'.repeat(Math.max(0, fractionDigits - 1))}1`;
  return `${group(integer)}${fraction ? `.${fraction.slice(0, fractionDigits)}` : ''}`;
}
export function formatAddress(value: string): string { return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
export function formatHash(value: string): string { return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value; }
export function formatDateTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return unavailable;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
export function formatRelativeTime(value: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000)); if (!Number.isFinite(seconds)) return unavailable;
  if (seconds < 60) return `${seconds}s ago`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return `${Math.floor(seconds / 86400)}d ago`;
}
