import { isEthereumAddress, type AlertCreateInput, type AlertType, type AlertUpdateInput } from '@blockchain-explorer/contracts/browser';

export interface AlertDraft { type: AlertType; enabled: boolean; walletAddress: string; tokenAddress: string; thresholdUsd: string; }
export type AlertValidationKey = 'alerts.validationWallet' | 'alerts.validationToken' | 'alerts.validationThreshold';
export type AlertFormErrors = Partial<Record<'walletAddress' | 'tokenAddress' | 'thresholdUsd', AlertValidationKey>>;
export type AlertValidation = { valid: true; input: AlertCreateInput } | { valid: false; errors: AlertFormErrors };
export const alertTypeKeys = { whale: 'alerts.types.whale', price_above: 'alerts.types.price_above', price_below: 'alerts.types.price_below', wallet_activity: 'alerts.types.wallet_activity' } as const satisfies Record<AlertType, string>;
export function isPositiveThreshold(value: string): boolean { return /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value) && /[1-9]/.test(value); }
export function validateAlertForm(draft: AlertDraft, editing = false): AlertValidation {
  const errors: AlertFormErrors = {};
  const price = draft.type === 'price_above' || draft.type === 'price_below';
  const wallet = price ? '' : draft.walletAddress.trim();
  const token = draft.tokenAddress.trim();
  const threshold = draft.type === 'wallet_activity' ? '' : draft.thresholdUsd.trim();
  if ((draft.type === 'wallet_activity' || wallet) && !isEthereumAddress(wallet)) errors.walletAddress = 'alerts.validationWallet';
  if (token && !isEthereumAddress(token)) errors.tokenAddress = 'alerts.validationToken';
  if ((price || (editing && draft.type === 'whale') || threshold) && !isPositiveThreshold(threshold)) errors.thresholdUsd = 'alerts.validationThreshold';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, input: { type: draft.type, enabled: draft.enabled, ...(wallet ? { walletAddress: wallet } : {}), ...(token ? { tokenAddress: token } : {}), ...(threshold ? { thresholdUsd: threshold } : {}) } };
}
export function alertUpdate(input: AlertCreateInput): AlertUpdateInput {
  // Explicit nulls clear fields that are not meaningful for a newly selected rule type.
  return { type: input.type, enabled: input.enabled, walletAddress: input.walletAddress ?? null, tokenAddress: input.tokenAddress ?? null, thresholdUsd: input.thresholdUsd ?? null };
}
