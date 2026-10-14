import { isEthereumAddress, type AlertCreateInput, type AlertType, type AlertUpdateInput } from '@blockchain-explorer/contracts/browser';

export interface AlertDraft { type: AlertType; enabled: boolean; walletAddress: string; tokenAddress: string; thresholdUsd: string; }
export type AlertFormErrors = Partial<Record<'walletAddress' | 'tokenAddress' | 'thresholdUsd', string>>;
export type AlertValidation = { valid: true; input: AlertCreateInput } | { valid: false; errors: AlertFormErrors };
export const alertTypeLabels: Record<AlertType, string> = { whale: 'Whale transfer', price_above: 'Price above', price_below: 'Price below', wallet_activity: 'Wallet activity' };
export function isPositiveThreshold(value: string): boolean { return /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value) && /[1-9]/.test(value); }
export function validateAlertForm(draft: AlertDraft, editing = false): AlertValidation {
  const errors: AlertFormErrors = {};
  const price = draft.type === 'price_above' || draft.type === 'price_below';
  const wallet = price ? '' : draft.walletAddress.trim();
  const token = draft.tokenAddress.trim();
  const threshold = draft.type === 'wallet_activity' ? '' : draft.thresholdUsd.trim();
  if ((draft.type === 'wallet_activity' || wallet) && !isEthereumAddress(wallet)) errors.walletAddress = 'Enter a valid Ethereum wallet address.';
  if (token && !isEthereumAddress(token)) errors.tokenAddress = 'Enter a valid Ethereum token contract address.';
  if ((price || (editing && draft.type === 'whale') || threshold) && !isPositiveThreshold(threshold)) errors.thresholdUsd = 'Enter a positive decimal with at most 60 integer and 18 fractional digits.';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, input: { type: draft.type, enabled: draft.enabled, ...(wallet ? { walletAddress: wallet } : {}), ...(token ? { tokenAddress: token } : {}), ...(threshold ? { thresholdUsd: threshold } : {}) } };
}
export function alertUpdate(input: AlertCreateInput): AlertUpdateInput {
  // Explicit nulls clear fields that are not meaningful for a newly selected rule type.
  return { type: input.type, enabled: input.enabled, walletAddress: input.walletAddress ?? null, tokenAddress: input.tokenAddress ?? null, thresholdUsd: input.thresholdUsd ?? null };
}
