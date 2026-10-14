'use client';

import { useId, useState, type FormEvent } from 'react';
import { isEthereumAddress } from '@blockchain-explorer/contracts/browser';
import { Button, Input, Modal } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';

export function NameForm({ initialName = '', wallet = false, submitLabel, onSubmit }: { initialName?: string; wallet?: boolean; submitLabel: string; onSubmit: (name: string, address: string) => Promise<void> }) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 100) { setError('Enter a name between 1 and 100 characters.'); return; }
    if (wallet && !isEthereumAddress(address.trim())) { setError('Enter a valid Ethereum wallet address.'); return; }
    setBusy(true); setError(null);
    try { await onSubmit(name.trim(), address.trim()); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit}>
    <div className="field"><label htmlFor={`${id}-name`}>Name</label><Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} required maxLength={100} autoFocus autoComplete="off" disabled={busy} /></div>
    {wallet && <div className="field"><label htmlFor={`${id}-wallet`}>Ethereum wallet address</label><Input id={`${id}-wallet`} value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." required autoComplete="off" spellCheck={false} disabled={busy} /><small className="muted">Balance sync starts after you add the wallet.</small></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Saving...' : submitLabel}</Button>
  </form>;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: { title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (cause) { setError(errorMessage(cause)); setBusy(false); }
  }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
    <p>{description}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="actions"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" onClick={() => void confirm()} disabled={busy}>{busy ? 'Working...' : confirmLabel}</Button></div>
  </Modal>;
}
