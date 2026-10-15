import { describe, expect, it } from 'vitest';
import { alertUpdate, isPositiveThreshold, validateAlertForm, type AlertDraft } from './alert-form-validation';

const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const draft: AlertDraft = { type: 'price_above', enabled: true, walletAddress: '', tokenAddress: '', thresholdUsd: '2500.123456789012345678' };
describe('alert form validation against public DTO semantics', () => {
  it('preserves exact positive decimal thresholds', () => { const result = validateAlertForm(draft); expect(result).toEqual({ valid: true, input: { type: 'price_above', enabled: true, thresholdUsd: '2500.123456789012345678' } }); });
  it.each(['0', '0.000', '-1', '1e5', '01', '1.1234567890123456789', '9'.repeat(61)])('rejects invalid threshold %s', threshold => { expect(isPositiveThreshold(threshold)).toBe(false); expect(validateAlertForm({ ...draft, thresholdUsd: threshold }).valid).toBe(false); });
  it('allows exact one-wei USD and the maximum integer length', () => { expect(isPositiveThreshold('0.000000000000000001')).toBe(true); expect(isPositiveThreshold('9'.repeat(60))).toBe(true); });
  it('requires a wallet for activity while omitting stale threshold fields', () => {
    expect(validateAlertForm({ ...draft, type: 'wallet_activity' }).valid).toBe(false);
    expect(validateAlertForm({ ...draft, type: 'wallet_activity', walletAddress: wallet, tokenAddress: token })).toEqual({ valid: true, input: { type: 'wallet_activity', enabled: true, walletAddress: wallet, tokenAddress: token } });
  });
  it('does not submit a hidden wallet filter on a price rule', () => { const result = validateAlertForm({ ...draft, walletAddress: wallet }); if (!result.valid) throw new Error('Expected valid form'); expect(result.input.walletAddress).toBeUndefined(); });
  it('uses server default only for new whale rules', () => { expect(validateAlertForm({ ...draft, type: 'whale', thresholdUsd: '' })).toEqual({ valid: true, input: { type: 'whale', enabled: true } }); expect(validateAlertForm({ ...draft, type: 'whale', thresholdUsd: '' }, true).valid).toBe(false); });
  it('clears previous fields when changing the rule type', () => { expect(alertUpdate({ type: 'wallet_activity', enabled: false, walletAddress: wallet })).toEqual({ type: 'wallet_activity', enabled: false, walletAddress: wallet, tokenAddress: null, thresholdUsd: null }); });
  it('rejects malformed optional token and wallet filters', () => { const result = validateAlertForm({ ...draft, type: 'whale', tokenAddress: '0xno', walletAddress: 'hello' }); expect(result.valid).toBe(false); if (!result.valid) { expect(result.errors.tokenAddress).toBeDefined(); expect(result.errors.walletAddress).toBeDefined(); } });
  it('returns locale-independent validation keys while retaining exact user input', () => {
    const invalid = { ...draft, tokenAddress: '0xno', thresholdUsd: '1e5' };
    const result = validateAlertForm(invalid);
    if (result.valid) throw new Error('Expected invalid form');
    expect(result.errors).toEqual({ tokenAddress: 'alerts.validationToken', thresholdUsd: 'alerts.validationThreshold' });
    expect(invalid.thresholdUsd).toBe('1e5');
  });
});
