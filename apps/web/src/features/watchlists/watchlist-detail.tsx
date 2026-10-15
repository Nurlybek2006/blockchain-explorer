'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { isEthereumAddress, type WatchlistItemResponse, type WatchlistItemType } from '@blockchain-explorer/contracts/browser';
import { AddressLink, Badge, Button, Card, CopyButton, EmptyState, ErrorState, Input, Modal, PageHeading, Skeleton, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { errorMessage } from '@/lib/api/client';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { useToast } from '@/providers/toast-provider';
import { ConfirmDialog, NameForm } from '../portfolio/forms';
import { useTranslation } from '@/hooks/use-translation';

function AddItemForm({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { t, locale } = useTranslation();
  const inputId = useId();
  const [type, setType] = useState<WatchlistItemType>('address');
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: 'watchlists.validationAddress' | 'watchlists.validationLabel' } | { cause: unknown } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (!isEthereumAddress(address.trim())) { setError({ key: 'watchlists.validationAddress' }); return; }
    if (label.trim().length > 100) { setError({ key: 'watchlists.validationLabel' }); return; }
    setBusy(true); setError(null);
    try { await intelligenceApi.addItem(id, { itemType: type, address: address.trim(), ...(label.trim() ? { label: label.trim() } : {}) }); onSaved(); }
    catch (cause) { setError({ cause }); }
    finally { setBusy(false); }
  }
  return <form className="page-stack" onSubmit={submit} noValidate>
    <div className="field"><label htmlFor={`${inputId}-type`}>{t('watchlists.itemType')}</label><select id={`${inputId}-type`} value={type} disabled={busy} onChange={event => { const value = event.target.value; if (value === 'address' || value === 'token') setType(value); }}><option value="address">{t('watchlists.walletOrContract')}</option><option value="token">{t('watchlists.tokenContract')}</option></select></div>
    <div className="field"><label htmlFor={`${inputId}-address`}>{t('watchlists.ethereumAddress')}</label><Input id={`${inputId}-address`} value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." required autoComplete="off" spellCheck={false} disabled={busy} /></div>
    <div className="field"><label htmlFor={`${inputId}-label`}>{t('watchlists.optionalLabel')}</label><Input id={`${inputId}-label`} value={label} onChange={event => setLabel(event.target.value)} maxLength={100} disabled={busy} /></div>
    {error && <p className="form-error" role="alert">{'key' in error ? t(error.key) : errorMessage(error.cause, locale, 'watchlist-item')}</p>}
    <Button type="submit" disabled={busy}>{t(busy ? 'watchlists.adding' : 'watchlists.addItem')}</Button>
  </form>;
}
export function WatchlistDetail({ id }: { id: string }) {
  const { t } = useTranslation();
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
    <Link href="/watchlists" className="muted">{t('watchlists.all')}</Link>
    <PageHeading eyebrow={t('watchlists.singular')} title={watchlist.name} description={t('watchlists.detailDescription')} action={<div className="actions"><Button variant="secondary" onClick={() => setEditing(true)}>{t('portfolio.rename')}</Button><Button variant="danger" onClick={() => setDeleting(true)}>{t('alerts.delete')}</Button></div>} />
    <Card title={t(watchlist.items.length === 1 ? 'watchlists.savedItemsOne' : 'watchlists.savedItems', { count: watchlist.items.length })} action={<Button onClick={() => setAdding(true)}>{t('watchlists.addItem')}</Button>}>
      {!watchlist.items.length ? <EmptyState title={t('watchlists.empty')} description={t('watchlists.emptyDescription')} action={<Button onClick={() => setAdding(true)}>{t('watchlists.addItem')}</Button>} /> : <Table label={t('watchlists.itemsTable')}><thead><tr><th>{t('watchlists.label')}</th><th>{t('watchlists.address')}</th><th>{t('watchlists.type')}</th><th>{t('watchlists.actions')}</th></tr></thead><tbody>{watchlist.items.map(item => <tr key={item.id}>
        <td><Link href={item.itemType === 'token' ? `/token/${item.address}` : `/address/${item.address}`}>{item.label ?? t(item.itemType === 'token' ? 'watchlists.tokenContract' : 'watchlists.ethereumAddress')}</Link></td>
        <td><div className="actions"><AddressLink address={item.address} /><CopyButton value={item.address} /></div></td><td><Badge>{t(item.itemType === 'token' ? 'watchlists.token' : 'watchlists.address')}</Badge></td>
        <td><Button variant="ghost" onClick={() => setRemoving(item)} aria-label={t('watchlists.removeLabel', { name: item.label ?? item.address })}>{t('watchlists.remove')}</Button></td>
      </tr>)}</tbody></Table>}
    </Card>
    {adding && <Modal title={t('watchlists.addTitle')} onClose={() => setAdding(false)}><AddItemForm id={id} onSaved={() => { setAdding(false); resource.reload(); notify('watchlists.added', 'success'); }} /></Modal>}
    {editing && <Modal title={t('watchlists.rename')} onClose={() => setEditing(false)}><NameForm initialName={watchlist.name} submitLabel={t('portfolio.saveName')} onSubmit={async name => { await intelligenceApi.renameWatchlist(id, { name }); setEditing(false); resource.reload(); notify('watchlists.renamed', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title={t('watchlists.deleteTitle')} description={t('watchlists.deleteDescription')} confirmLabel={t('watchlists.delete')} onClose={() => setDeleting(false)} onConfirm={async () => { await intelligenceApi.deleteWatchlist(id); setDeleting(false); notify('watchlists.deleted', 'success'); router.replace('/watchlists'); }} />}
    {removing && <ConfirmDialog title={t('watchlists.removeTitle')} description={t('watchlists.removeDescription', { name: removing.label ?? removing.address })} confirmLabel={t('watchlists.removeConfirm')} onClose={() => setRemoving(null)} onConfirm={async () => { await intelligenceApi.removeItem(id, removing.id); setRemoving(null); resource.reload(); notify('watchlists.removed', 'success'); }} />}
  </div>;
}
