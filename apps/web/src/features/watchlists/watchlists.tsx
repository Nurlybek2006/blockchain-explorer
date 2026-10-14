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

export function Watchlists({ page }: { page: number }) {
  const resource = useResource(useCallback((signal: AbortSignal) => intelligenceApi.watchlists(page, signal), [page]));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WatchlistResponse | null>(null);
  const [deleting, setDeleting] = useState<WatchlistResponse | null>(null);
  const router = useRouter();
  const { notify } = useToast();
  return <div className="page-stack">
    <PageHeading eyebrow="Your workspace" title="Watchlists" description="Organize addresses and tokens you want to follow." action={<Button onClick={() => setCreating(true)}>Create watchlist</Button>} />
    {resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : !resource.data ? <Skeleton /> : !resource.data.items.length ? <EmptyState title={page === 1 ? 'Start a watchlist' : 'No watchlists on this page'} description="Save Ethereum addresses and token contracts in one place." action={page === 1 ? <Button onClick={() => setCreating(true)}>Create watchlist</Button> : <Link href="/watchlists">Return to first page</Link>} /> : <>
      <div className="grid-three">{resource.data.items.map(item => <Card key={item.id} title={item.name}>
        <p className="muted">Created {formatDateTime(item.createdAt)}</p>
        <div className="actions"><Link href={`/watchlists/${item.id}`}>Open watchlist →</Link><Button variant="ghost" onClick={() => setEditing(item)}>Rename</Button><Button variant="ghost" onClick={() => setDeleting(item)}>Delete</Button></div>
      </Card>)}</div>
      <Pagination page={page} totalPages={resource.data.totalPages} onPageChange={next => router.push(`/watchlists?page=${next}`)} />
    </>}
    {creating && <Modal title="Create watchlist" onClose={() => setCreating(false)}><NameForm submitLabel="Create watchlist" onSubmit={async name => { const result = await intelligenceApi.createWatchlist({ name }); setCreating(false); notify('Watchlist created.', 'success'); router.push(`/watchlists/${result.id}`); }} /></Modal>}
    {editing && <Modal title="Rename watchlist" onClose={() => setEditing(null)}><NameForm initialName={editing.name} submitLabel="Save name" onSubmit={async name => { await intelligenceApi.renameWatchlist(editing.id, { name }); setEditing(null); resource.reload(); notify('Watchlist renamed.', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title="Delete watchlist?" description={`“${deleting.name}” and all its saved items will be removed.`} confirmLabel="Delete watchlist" onClose={() => setDeleting(null)} onConfirm={async () => { await intelligenceApi.deleteWatchlist(deleting.id); setDeleting(null); if (resource.data?.items.length === 1 && page > 1) router.push(`/watchlists?page=${page - 1}`); else resource.reload(); notify('Watchlist deleted.', 'success'); }} />}
  </div>;
}
