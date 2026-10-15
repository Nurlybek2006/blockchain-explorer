'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { WatchlistResponse } from '@blockchain-explorer/contracts';
import { Button, Card, EmptyState, ErrorState, Modal, PageHeading, Pagination, Skeleton } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { formatDateTime } from '@/lib/format';
import { useToast } from '@/providers/toast-provider';
import { ConfirmDialog, NameForm } from '../portfolio/forms';
import { useTranslation } from '@/hooks/use-translation';

export function Watchlists({ page }: { page: number }) {
  const { t, locale } = useTranslation();
  const resource = useResource(useCallback((signal: AbortSignal) => intelligenceApi.watchlists(page, signal), [page]));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WatchlistResponse | null>(null);
  const [deleting, setDeleting] = useState<WatchlistResponse | null>(null);
  const router = useRouter();
  const { notify } = useToast();
  return <div className="page-stack">
    <PageHeading eyebrow={t('portfolio.workspace')} title={t('watchlists.title')} description={t('watchlists.description')} action={<Button onClick={() => setCreating(true)}>{t('watchlists.create')}</Button>} />
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data ? <Skeleton /> : !resource.data.items.length ? <EmptyState title={t(page === 1 ? 'watchlists.start' : 'watchlists.emptyPage')} description={t('watchlists.saveDescription')} action={page === 1 ? <Button onClick={() => setCreating(true)}>{t('watchlists.create')}</Button> : <Link href="/watchlists">{t('portfolio.firstPage')}</Link>} /> : <>
      <div className="grid-three">{resource.data.items.map(item => <Card key={item.id} title={item.name}>
        <p className="muted">{t('watchlists.createdAt', { date: formatDateTime(item.createdAt, locale) })}</p>
        <div className="actions"><Link href={`/watchlists/${item.id}`}>{t('watchlists.open')}</Link><Button variant="ghost" onClick={() => setEditing(item)}>{t('portfolio.rename')}</Button><Button variant="ghost" onClick={() => setDeleting(item)}>{t('alerts.delete')}</Button></div>
      </Card>)}</div>
      <Pagination page={page} totalPages={resource.data.totalPages} onPageChange={next => router.push(`/watchlists?page=${next}`)} />
    </>}
    {creating && <Modal title={t('watchlists.create')} onClose={() => setCreating(false)}><NameForm submitLabel={t('watchlists.create')} onSubmit={async name => { const result = await intelligenceApi.createWatchlist({ name }); setCreating(false); notify('watchlists.created', 'success'); router.push(`/watchlists/${result.id}`); }} /></Modal>}
    {editing && <Modal title={t('watchlists.rename')} onClose={() => setEditing(null)}><NameForm initialName={editing.name} submitLabel={t('portfolio.saveName')} onSubmit={async name => { await intelligenceApi.renameWatchlist(editing.id, { name }); setEditing(null); resource.reload(); notify('watchlists.renamed', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title={t('watchlists.deleteTitle')} description={t('watchlists.deleteNamed', { name: deleting.name })} confirmLabel={t('watchlists.delete')} onClose={() => setDeleting(null)} onConfirm={async () => { await intelligenceApi.deleteWatchlist(deleting.id); setDeleting(null); if (resource.data?.items.length === 1 && page > 1) router.push(`/watchlists?page=${page - 1}`); else resource.reload(); notify('watchlists.deleted', 'success'); }} />}
  </div>;
}
