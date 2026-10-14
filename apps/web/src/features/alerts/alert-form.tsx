'use client';

import { useId, useState, type FormEvent } from 'react';
import type { AlertCreateInput, AlertResponse } from '@blockchain-explorer/contracts';
import { Button, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';
import { isAlertType } from '@/lib/api/intelligence.decoder';
import { alertTypeLabels, validateAlertForm, type AlertDraft, type AlertFormErrors } from './alert-form-validation';

export function AlertForm({ initial, onSubmit }: { initial?: AlertResponse; onSubmit: (input: AlertCreateInput) => Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState<AlertDraft>({ type: initial?.type ?? 'price_above', enabled: initial?.enabled ?? true, walletAddress: initial?.walletAddress ?? '', tokenAddress: initial?.tokenAddress ?? '', thresholdUsd: initial?.thresholdUsd ?? '' });
  const [errors, setErrors] = useState<AlertFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const price = draft.type === 'price_above' || draft.type === 'price_below';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const result = validateAlertForm(draft, initial !== undefined);
    if (!result.valid) { setErrors(result.errors); return; }
    setErrors({}); setServerError(null); setBusy(true);
    try { await onSubmit(result.input); }
    catch (cause) { setServerError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit}>
    <div className="field"><label htmlFor={`${id}-type`}>Alert type</label><select id={`${id}-type`} value={draft.type} disabled={busy} onChange={event => { const type = event.target.value; if (isAlertType(type)) { setDraft(previous => ({ ...previous, type })); setErrors({}); } }}>{Object.entries(alertTypeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></div>
    {!price && <div className="field"><label htmlFor={`${id}-wallet`}>Wallet address{draft.type === 'whale' ? ' (optional filter)' : ''}</label><Input id={`${id}-wallet`} value={draft.walletAddress} onChange={event => setDraft(previous => ({ ...previous, walletAddress: event.target.value }))} required={draft.type === 'wallet_activity'} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={Boolean(errors.walletAddress)} aria-describedby={errors.walletAddress ? `${id}-wallet-error` : undefined} />{errors.walletAddress && <small id={`${id}-wallet-error`} className="form-error">{errors.walletAddress}</small>}</div>}
    <div className="field"><label htmlFor={`${id}-token`}>{price ? 'Token contract (leave empty for ETH)' : 'Token contract (optional filter)'}</label><Input id={`${id}-token`} value={draft.tokenAddress} onChange={event => setDraft(previous => ({ ...previous, tokenAddress: event.target.value }))} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={Boolean(errors.tokenAddress)} aria-describedby={errors.tokenAddress ? `${id}-token-error` : undefined} />{errors.tokenAddress && <small id={`${id}-token-error`} className="form-error">{errors.tokenAddress}</small>}</div>
    {draft.type !== 'wallet_activity' && <div className="field"><label htmlFor={`${id}-threshold`}>USD threshold{draft.type === 'whale' && !initial ? ' (optional)' : ''}</label><Input id={`${id}-threshold`} value={draft.thresholdUsd} onChange={event => setDraft(previous => ({ ...previous, thresholdUsd: event.target.value }))} required={price || initial !== undefined} placeholder="e.g. 2500.00" inputMode="decimal" autoComplete="off" disabled={busy} aria-invalid={Boolean(errors.thresholdUsd)} aria-describedby={errors.thresholdUsd ? `${id}-threshold-error` : undefined} />{errors.thresholdUsd && <small id={`${id}-threshold-error`} className="form-error">{errors.thresholdUsd}</small>}{draft.type === 'whale' && !initial && <small className="muted">Leave empty to use the server&apos;s configured whale threshold.</small>}</div>}
    <label className="actions"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(previous => ({ ...previous, enabled: event.target.checked }))} disabled={busy} /> Enable rule</label>
    <p className="muted">{price ? 'Price rules trigger when the observed condition crosses from false to true. The first fresh price establishes a baseline.' : 'Activity rules monitor indexed ERC-20 transfers. Native ETH transactions are not covered.'}</p>
    {serverError && <p className="form-error" role="alert">{serverError}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Saving...' : initial ? 'Save alert' : 'Create alert'}</Button>
  </form>;
}
