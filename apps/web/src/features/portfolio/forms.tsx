'use client';

import { useId, useState, type FormEvent } from 'react';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { Button, Input, Modal } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';
import { useTranslation } from '@/hooks/use-translation';

export function NameForm({ initialName = '', wallet = false, submitLabel, onSubmit }: { initialName?: string; wallet?: boolean; submitLabel: string; onSubmit: (name: string, address: string) => Promise<void> }) {
  const { t, locale } = useTranslation();
  const id = useId();
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: 'portfolio.validationName' | 'portfolio.validationWallet' } | { cause: unknown } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 100) { setError({ key: 'portfolio.validationName' }); return; }
    if (wallet && !isEthereumAddress(address.trim())) { setError({ key: 'portfolio.validationWallet' }); return; }
    setBusy(true); setError(null);
    try { await onSubmit(name.trim(), address.trim()); }
    catch (cause) { setError({ cause }); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit} noValidate>
    <div className="field"><label htmlFor={`${id}-name`}>{t('portfolio.name')}</label><Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} required maxLength={100} autoFocus autoComplete="off" disabled={busy} /></div>
    {wallet && <div className="field"><label htmlFor={`${id}-wallet`}>{t('portfolio.walletAddress')}</label><Input id={`${id}-wallet`} value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." required autoComplete="off" spellCheck={false} disabled={busy} /><small className="muted">{t('portfolio.syncStarts')}</small></div>}
    {error && <p className="form-error" role="alert">{'key' in error ? t(error.key) : errorMessage(error.cause, locale)}</p>}
    <Button type="submit" disabled={busy}>{busy ? t('portfolio.saving') : submitLabel}</Button>
  </form>;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: { title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (cause) { setError({ cause }); setBusy(false); }
  }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
    <p>{description}</p>
    {error && <p role="alert" className="form-error">{errorMessage(error.cause, locale)}</p>}
    <div className="actions"><Button variant="secondary" onClick={onClose} disabled={busy}>{t('portfolio.cancel')}</Button><Button variant="danger" onClick={() => void confirm()} disabled={busy}>{busy ? t('portfolio.working') : confirmLabel}</Button></div>
  </Modal>;
}
