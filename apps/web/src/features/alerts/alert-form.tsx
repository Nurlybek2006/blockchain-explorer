'use client';

import { useId, useState, type FormEvent } from 'react';
import type { AlertCreateInput, AlertResponse } from '@blockchain-explorer/contracts';
import { Button, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';
import { isAlertType } from '@/lib/api/intelligence.decoder';
import { alertTypeKeys, validateAlertForm, type AlertDraft, type AlertFormErrors } from './alert-form-validation';
import { useTranslation } from '@/hooks/use-translation';

export function AlertForm({ initial, onSubmit }: { initial?: AlertResponse; onSubmit: (input: AlertCreateInput) => Promise<void> }) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<AlertDraft>({ type: initial?.type ?? 'price_above', enabled: initial?.enabled ?? true, walletAddress: initial?.walletAddress ?? '', tokenAddress: initial?.tokenAddress ?? '', thresholdUsd: initial?.thresholdUsd ?? '' });
  const [errors, setErrors] = useState<AlertFormErrors>({});
  const [serverError, setServerError] = useState<{ cause: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const price = draft.type === 'price_above' || draft.type === 'price_below';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const result = validateAlertForm(draft, initial !== undefined);
    if (!result.valid) { setErrors(result.errors); return; }
    setErrors({}); setServerError(null); setBusy(true);
    try { await onSubmit(result.input); }
    catch (cause) { setServerError({ cause }); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit} noValidate>
    <div className="field"><label htmlFor={`${id}-type`}>{t('alerts.type')}</label><select id={`${id}-type`} value={draft.type} disabled={busy} onChange={event => { const type = event.target.value; if (isAlertType(type)) { setDraft(previous => ({ ...previous, type })); setErrors({}); } }}>{Object.entries(alertTypeKeys).map(([type, key]) => <option key={type} value={type}>{t(key)}</option>)}</select></div>
    {!price && <div className="field"><label htmlFor={`${id}-wallet`}>{t(draft.type === 'whale' ? 'alerts.walletOptional' : 'alerts.walletAddress')}</label><Input id={`${id}-wallet`} value={draft.walletAddress} onChange={event => setDraft(previous => ({ ...previous, walletAddress: event.target.value }))} required={draft.type === 'wallet_activity'} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={Boolean(errors.walletAddress)} aria-describedby={errors.walletAddress ? `${id}-wallet-error` : undefined} />{errors.walletAddress && <small id={`${id}-wallet-error`} className="form-error">{t(errors.walletAddress)}</small>}</div>}
    <div className="field"><label htmlFor={`${id}-token`}>{t(price ? 'alerts.tokenEth' : 'alerts.tokenOptional')}</label><Input id={`${id}-token`} value={draft.tokenAddress} onChange={event => setDraft(previous => ({ ...previous, tokenAddress: event.target.value }))} placeholder="0x..." autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={Boolean(errors.tokenAddress)} aria-describedby={errors.tokenAddress ? `${id}-token-error` : undefined} />{errors.tokenAddress && <small id={`${id}-token-error`} className="form-error">{t(errors.tokenAddress)}</small>}</div>
    {draft.type !== 'wallet_activity' && <div className="field"><label htmlFor={`${id}-threshold`}>{t(draft.type === 'whale' && !initial ? 'alerts.usdThresholdOptional' : 'alerts.usdThreshold')}</label><Input id={`${id}-threshold`} value={draft.thresholdUsd} onChange={event => setDraft(previous => ({ ...previous, thresholdUsd: event.target.value }))} required={price || initial !== undefined} placeholder={t('alerts.thresholdPlaceholder')} inputMode="decimal" autoComplete="off" disabled={busy} aria-invalid={Boolean(errors.thresholdUsd)} aria-describedby={errors.thresholdUsd ? `${id}-threshold-error` : undefined} />{errors.thresholdUsd && <small id={`${id}-threshold-error`} className="form-error">{t(errors.thresholdUsd)}</small>}{draft.type === 'whale' && !initial && <small className="muted">{t('alerts.serverThreshold')}</small>}</div>}
    <label className="actions"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(previous => ({ ...previous, enabled: event.target.checked }))} disabled={busy} /> {t('alerts.enableRule')}</label>
    <p className="muted">{t(price ? 'alerts.priceScope' : 'alerts.activityScope')}</p>
    {serverError && <p className="form-error" role="alert">{errorMessage(serverError.cause, locale)}</p>}
    <Button type="submit" disabled={busy}>{t(busy ? 'portfolio.saving' : initial ? 'alerts.save' : 'alerts.create')}</Button>
  </form>;
}
