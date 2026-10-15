import type { AlertEventResponse, AlertType } from '@blockchain-explorer/contracts';
import { isAlertType } from '@/lib/api/intelligence.decoder';
import { formatDecimal, formatUsd } from '@/lib/format';
import { createTranslator } from '@/i18n/translator';
import type { Locale } from '@/i18n/types';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function payloadRecord(value: unknown): Record<string, unknown> | null { return isRecord(value) ? value : null; }
export function payloadText(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}
export function eventType(event: AlertEventResponse): AlertType | null {
  const payload = payloadRecord(event.payload);
  if (typeof payload?.type === 'string' && isAlertType(payload.type)) return payload.type;
  // Older transfer events carry semantic titles instead of a type in their payload.
  // Match the known values without rendering arbitrary backend text.
  if (event.title === 'Whale token transfer') return 'whale';
  if (event.title === 'Wallet token activity') return 'wallet_activity';
  return null;
}
function decimal(value: string | null): value is string { return value !== null && /^\d+(?:\.\d+)?$/.test(value); }
export function alertEventDisplay(event: AlertEventResponse, locale: Locale, fallbackType?: AlertType) {
  const t = createTranslator(locale);
  const type = eventType(event) ?? fallbackType;
  const title = t(type ? `alerts.eventTitles.${type}` : 'alerts.eventTitles.unknown');
  const payload = payloadRecord(event.payload);
  if (!payload) return { title, message: t('alerts.unknownMessage') };
  const symbol = payloadText(payload, 'symbol') ?? t('alerts.tokensFallback');
  const price = payloadText(payload, 'priceUsd'), threshold = payloadText(payload, 'thresholdUsd');
  if ((type === 'price_above' || type === 'price_below') && decimal(price) && decimal(threshold)) {
    return { title, message: t('alerts.priceMessage', { symbol, price: formatUsd(price, locale), threshold: formatUsd(threshold, locale) }) };
  }
  const amount = payloadText(payload, 'amountFormatted'), value = payloadText(payload, 'valueUsd');
  if ((type === 'whale' || type === 'wallet_activity') && decimal(amount)) {
    const localizedAmount = formatDecimal(amount, locale);
    return { title, message: decimal(value)
      ? t('alerts.transferPricedMessage', { amount: localizedAmount, symbol, value: formatUsd(value, locale) })
      : t('alerts.transferMessage', { amount: localizedAmount, symbol }) };
  }
  return { title, message: t('alerts.unknownMessage') };
}
