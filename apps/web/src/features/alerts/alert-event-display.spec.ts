import { describe, expect, it } from 'vitest';
import type { AlertEventResponse } from '@blockchain-explorer/contracts';
import { alertEventDisplay, eventType } from './alert-event-display';
import { formatDecimal, formatUsd } from '@/lib/format';

const base: AlertEventResponse = { id: 'event-1', alertId: 'alert-1', title: 'Untrusted backend message', message: 'Private provider stack and internal details', payload: null, triggeredAt: '2026-10-14T12:00:00Z', readAt: null };
describe('localized alert event presentation', () => {
  it('never exposes arbitrary backend titles or messages in either locale', () => {
    for (const locale of ['kk', 'en'] as const) {
      const display = alertEventDisplay(base, locale);
      expect(display.title).not.toContain(base.title);
      expect(display.message).not.toContain(base.message);
      expect(display.title).toBe(locale === 'kk' ? 'Ескерту шарты байқалды' : 'Alert condition observed');
    }
  });
  it('localizes price crossings from payload semantics and formats the currency', () => {
    const event = { ...base, payload: { type: 'price_above', symbol: 'ETH', priceUsd: '2500.125', thresholdUsd: '2500' } };
    const english = alertEventDisplay(event, 'en'), kazakh = alertEventDisplay(event, 'kk');
    expect(english.title).toBe('Price rose above threshold');
    expect(kazakh.title).toBe('Баға шекті мәннен жоғары көтерілді');
    expect(english.message).toContain('ETH price is $2,500.13');
    expect(kazakh.message).toContain(`ETH бағасы: ${formatUsd('2500.125', 'kk')}`);
  });
  it('recognizes older transfer events even when their rule is on a different page', () => {
    const event = { ...base, title: 'Whale token transfer', payload: { amountFormatted: '12345678901234567890.123456789012345678', symbol: 'ERC-20', valueUsd: '123.45' } };
    expect(eventType(event)).toBe('whale');
    const display = alertEventDisplay(event, 'kk');
    expect(display.title).toBe('Токеннің ірі аударымы');
    expect(display.message).toContain(`${formatDecimal('12345678901234567890.123456789012345678', 'kk')} ERC-20`);
    expect(display.message).toContain('ағымдағы бағамен');
  });
  it('preserves wallet activity without implying a price when valuation is absent', () => {
    const event = { ...base, title: 'Wallet token activity', payload: { amountFormatted: '0.000000000000000001', symbol: null, valueUsd: null } };
    expect(alertEventDisplay(event, 'en').message).toBe('0.000000000000000001 tokens transferred.');
    expect(alertEventDisplay(event, 'kk').message).toBe('0,000000000000000001 токен аударылды.');
  });
  it('does not render malformed decimal data or arbitrary messages as valid events', () => {
    const event = { ...base, payload: { type: 'price_below', symbol: 'ETH', priceUsd: 'secret-provider-response', thresholdUsd: '100' } };
    const display = alertEventDisplay(event, 'kk');
    expect(display.title).toBe('Баға шекті мәннен төмен түсті');
    expect(display.message).not.toContain('secret-provider-response');
    expect(display.message).toContain('Қолжетімді оқиға мәліметтерін');
  });
  it('accepts a known rule type fallback and leaves the backend object unchanged', () => {
    const event = { ...base, payload: { amountFormatted: '1', symbol: 'ETH', valueUsd: null } };
    const before = JSON.stringify(event);
    expect(alertEventDisplay(event, 'en', 'wallet_activity').title).toBe('Wallet token activity');
    expect(JSON.stringify(event)).toBe(before);
    expect(eventType({ ...base, title: 'arbitrary wallet_activity' })).toBeNull();
  });
});
