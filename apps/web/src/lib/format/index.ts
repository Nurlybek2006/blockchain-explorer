import { intlLocale } from '../../i18n/config';
import type { Locale } from '../../i18n/types';

const unavailable = '—';
function decimalParts(value: string): { negative: boolean; integer: string; fraction: string } | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith('-'), [integer, fraction = ''] = value.replace(/^-/, '').split('.');
  if (integer === undefined) return null;
  return { negative, integer: integer.replace(/^0+(?=\d)/, ''), fraction };
}
function group(value: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(BigInt(value));
}
function separator(locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
}
function roundedParts(value: string, digits: number): { negative: boolean; integer: string; fraction: string } | null {
  const parts = decimalParts(value); if (!parts) return null;
  const fraction = parts.fraction.padEnd(digits + 1, '0');
  const scaled = BigInt(parts.integer + fraction.slice(0, digits)) + (Number(fraction[digits]) >= 5 ? 1n : 0n);
  const text = scaled.toString().padStart(digits + 1, '0');
  return { negative: parts.negative && scaled !== 0n, integer: digits ? text.slice(0, -digits) : text, fraction: digits ? text.slice(-digits) : '' };
}
function rounded(value: string, digits: number, locale: Locale): string {
  const parts = roundedParts(value, digits); if (!parts) return unavailable;
  return `${parts.negative ? '-' : ''}${group(parts.integer, locale)}${digits ? `${separator(locale)}${parts.fraction}` : ''}`;
}

export function formatDecimal(value: string | null | undefined, locale: Locale = 'en'): string {
  if (value == null) return unavailable;
  const parts = decimalParts(value); if (!parts) return unavailable;
  return `${parts.negative ? '-' : ''}${group(parts.integer, locale)}${parts.fraction ? `${separator(locale)}${parts.fraction}` : ''}`;
}

/** Integer/fraction strings stay exact; Intl supplies grouping and currency placement only. */
export function formatUsd(value: string | null | undefined, locale: Locale = 'en'): string {
  if (value == null) return unavailable;
  const input = decimalParts(value); const parts = roundedParts(value, 2);
  if (!input || !parts) return unavailable;
  const subcent = input.integer === '0' && /[1-9]/.test(input.fraction) && !/[1-9]/.test(input.fraction.slice(0, 2));
  const integer = subcent ? '0' : parts.integer; const fraction = subcent ? '01' : parts.fraction;
  const template = new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(input.negative && !subcent && parts.negative ? -1 : 1);
  const money = template.map(part => part.type === 'integer' ? group(integer, locale) : part.type === 'fraction' ? fraction : part.value).join('');
  return subcent ? `${input.negative ? '-' : ''}<${money}` : money;
}
export function formatPercentage(value: string | null | undefined, locale: Locale = 'en'): string {
  if (value == null || !decimalParts(value)) return unavailable;
  const parts = roundedParts(value, 2); if (!parts) return unavailable;
  const text = rounded(value, 2, locale);
  const template = new Intl.NumberFormat(intlLocale(locale), { style: 'percent' }).formatToParts(1);
  const suffix = template.filter(part => part.type === 'literal' || part.type === 'percentSign').map(part => part.value).join('');
  return `${!parts.negative && (parts.integer !== '0' || parts.fraction !== '00') ? '+' : ''}${text}${suffix}`;
}
export function formatBigInteger(value: string | bigint | number | null | undefined, locale: Locale = 'en'): string {
  if (value == null || (typeof value === 'number' && !Number.isSafeInteger(value))) return unavailable;
  const text = String(value); return /^-?\d+$/.test(text) ? group(text, locale) : unavailable;
}
export const formatBlockNumber = formatBigInteger;
export const formatGas = formatBigInteger;
export function formatTokenAmount(raw: string, decimals: number, fractionDigits = 6, locale: Locale = 'en'): string {
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 255) return unavailable;
  const text = raw.replace(/^0+(?=\d)/, '').padStart(decimals + 1, '0');
  const integer = decimals ? text.slice(0, -decimals) : text;
  const fraction = decimals ? text.slice(-decimals).replace(/0+$/, '') : '';
  if (integer === '0' && fraction && !/[1-9]/.test(fraction.slice(0, fractionDigits))) return fractionDigits === 0 ? '<1' : `<0${separator(locale)}${'0'.repeat(fractionDigits - 1)}1`;
  const visibleFraction = fraction.slice(0, fractionDigits);
  return `${group(integer, locale)}${visibleFraction ? `${separator(locale)}${visibleFraction}` : ''}`;
}
export function formatAddress(value: string): string { return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
export function formatHash(value: string): string { return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value; }
export function formatDateTime(value: string | null | undefined, locale: Locale = 'en'): string {
  if (!value || !Number.isFinite(Date.parse(value))) return unavailable;
  return new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
export function formatRelativeTime(value: string, now = Date.now(), locale: Locale = 'en'): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000)); if (!Number.isFinite(seconds)) return unavailable;
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 60 ? [seconds, 'second'] : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : seconds < 86400 ? [Math.floor(seconds / 3600), 'hour'] : [Math.floor(seconds / 86400), 'day'];
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'always' }).format(-amount, unit);
}
