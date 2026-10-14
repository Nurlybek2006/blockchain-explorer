'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { isEthereumAddress, type WatchlistItemResponse, type WatchlistItemType } from '@blockchain-explorer/contracts/browser';
import { AddressLink, Badge, Button, Card, CopyButton, EmptyState, ErrorState, Input, Modal, PageHeading, Skeleton, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { ApiError, errorMessage } from '@/lib/api/client';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { useToast } from '@/providers/toast-provider';
import { ConfirmDialog, NameForm } from '../portfolio/forms';

function AddItemForm({ id, onSaved }: { id: string; onSaved: () => void }) {
  const inputId = useId();
  const [type, setType] = useState<WatchlistItemType>('address');
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (!isEthereumAddress(address.trim())) { setError('Enter a valid Ethereum address.'); return; }
    if (label.trim().length > 100) { setError('Labels can have at most 100 characters.'); return; }
    setBusy(true); setError(null);
    try { await intelligenceApi.addItem(id, { itemType: type, address: address.trim(), ...(label.trim() ? { label: label.trim() } : {}) }); onSaved(); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 409 ? 'This address and item type are already saved in this watchlist.' : errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit}>
    <div className="field"><label htmlFor={`${inputId}-type`}>Item type</label><select id={`${inputId}-type`} value={type} disabled={busy} onChange={event => { const value = event.target.value; if (value === 'address' || value === 'token') setType(value); }}><option value="address">Wallet or contract address</option><option value="token">Token contract</option></select></div>
    <div className="field"><label htmlFor={`${inputId}-address`}>Ethereum address</label><Input id={`${inputId}-address`} value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." required autoComplete="off" spellCheck={false} disabled={busy} /></div>
    <div className="field"><label htmlFor={`${inputId}-label`}>Label (optional)</label><Input id={`${inputId}-label`} value={label} onChange={event => setLabel(event.target.value)} maxLength={100} disabled={busy} /></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <Button type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add item'}</Button>
  </form>;
}
export function WatchlistDetail({ id }: { id: string }) {
  const resource = useResource(useCallback((signal: AbortSignal) => intelligenceApi.watchlist(id, signal), [id]));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState<WatchlistItemResponse | null>(null);
  const router = useRouter();
  const { notify } = useToast();
  if (resource.error) return <ErrorState error={resource.error} retry={resource.reload} />;
  if (!resource.data) return <Skeleton />;
  const watchlist = resource.data;
  return <div className="page-stack">
    <Link href="/watchlists" className="muted">← All watchlists</Link>
    <PageHeading eyebrow="Watchlist" title={watchlist.name} description="Saved addresses and token contracts." action={<div className="actions"><Button variant="secondary" onClick={() => setEditing(true)}>Rename</Button><Button variant="danger" onClick={() => setDeleting(true)}>Delete</Button></div>} />
    <Card title={`${watchlist.items.length} saved items`} action={<Button onClick={() => setAdding(true)}>Add item</Button>}>
      {!watchlist.items.length ? <EmptyState title="Your watchlist is empty" description="Add an address or token contract to keep it close." action={<Button onClick={() => setAdding(true)}>Add item</Button>} /> : <Table label="Saved watchlist items"><thead><tr><th>Label</th><th>Address</th><th>Type</th><th>Actions</th></tr></thead><tbody>{watchlist.items.map(item => <tr key={item.id}>
        <td><Link href={item.itemType === 'token' ? `/token/${item.address}` : `/address/${item.address}`}>{item.label ?? (item.itemType === 'token' ? 'Token contract' : 'Ethereum address')}</Link></td>
        <td><div className="actions"><AddressLink address={item.address} /><CopyButton value={item.address} /></div></td><td><Badge>{item.itemType === 'token' ? 'Token' : 'Address'}</Badge></td>
        <td><Button variant="ghost" onClick={() => setRemoving(item)} aria-label={`Remove ${item.label ?? item.address}`}>Remove</Button></td>
      </tr>)}</tbody></Table>}
    </Card>
    {adding && <Modal title="Add watchlist item" onClose={() => setAdding(false)}><AddItemForm id={id} onSaved={() => { setAdding(false); resource.reload(); notify('Item added to watchlist.', 'success'); }} /></Modal>}
    {editing && <Modal title="Rename watchlist" onClose={() => setEditing(false)}><NameForm initialName={watchlist.name} submitLabel="Save name" onSubmit={async name => { await intelligenceApi.renameWatchlist(id, { name }); setEditing(false); resource.reload(); notify('Watchlist renamed.', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title="Delete watchlist?" description="This watchlist and all its saved items will be removed." confirmLabel="Delete watchlist" onClose={() => setDeleting(false)} onConfirm={async () => { await intelligenceApi.deleteWatchlist(id); setDeleting(false); notify('Watchlist deleted.', 'success'); router.replace('/watchlists'); }} />}
    {removing && <ConfirmDialog title="Remove watchlist item?" description={`Remove ${removing.label ?? removing.address} from this watchlist?`} confirmLabel="Remove item" onClose={() => setRemoving(null)} onConfirm={async () => { await intelligenceApi.removeItem(id, removing.id); setRemoving(null); resource.reload(); notify('Item removed.', 'success'); }} />}
  </div>;
}
