'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { AlertResponse } from '@blockchain-explorer/contracts';
import { AddressLink, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeading, Pagination, Skeleton, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { errorMessage } from '@/lib/api/client';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { formatDateTime, formatUsd } from '@/lib/format';
import { useToast } from '@/providers/toast-provider';
import { ConfirmDialog } from '../portfolio/forms';
import { AlertForm } from './alert-form';
import { alertTypeLabels, alertUpdate } from './alert-form-validation';
import { AlertEventDetails, eventType } from './alert-event-details';
import styles from './alerts.module.css';

export function Alerts({ page, eventPage }: { page: number; eventPage: number }) {
  const rules = useResource(useCallback((signal: AbortSignal) => intelligenceApi.alerts(page, signal), [page]), { pollInterval: 30000 });
  const events = useResource(useCallback((signal: AbortSignal) => intelligenceApi.alertEvents(eventPage, signal), [eventPage]), { pollInterval: 30000 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AlertResponse | null>(null);
  const [deleting, setDeleting] = useState<AlertResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { notify } = useToast();
  const router = useRouter();
  const unread = events.data?.items.filter(event => event.readAt === null).length ?? 0;
  async function toggle(rule: AlertResponse) {
    if (busy) return;
    setBusy(rule.id);
    try { await intelligenceApi.updateAlert(rule.id, { enabled: !rule.enabled }); rules.reload(); notify(rule.enabled ? 'Alert disabled.' : 'Alert enabled.', 'success'); }
    catch (cause) { notify(errorMessage(cause), 'error'); }
    finally { setBusy(null); }
  }
  async function markRead(id: string) {
    if (busy) return;
    setBusy(id);
    try { await intelligenceApi.markRead(id); events.reload(); notify('Event marked as read.', 'success'); }
    catch (cause) { notify(errorMessage(cause), 'error'); }
    finally { setBusy(null); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow="Your workspace" title="Alerts" description="Track price crossings and indexed token activity." action={<Button onClick={() => setCreating(true)}>Create alert</Button>} />
    <Card title="Alert rules" action={<Button variant="ghost" onClick={rules.reload}>Refresh</Button>}>
      {rules.error ? <ErrorState error={rules.error} retry={rules.reload} /> : !rules.data ? <Skeleton /> : !rules.data.items.length ? <EmptyState title="No alert rules here" description="Create a rule to follow a price level or ERC-20 wallet activity." action={<Button onClick={() => setCreating(true)}>Create alert</Button>} /> : <>
        <Table label="Alert rules"><thead><tr><th>Rule</th><th>Asset / wallet</th><th>Threshold</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rules.data.items.map(rule => <tr key={rule.id}>
          <td><strong>{alertTypeLabels[rule.type]}</strong><small className={styles.timestamp}>{formatDateTime(rule.createdAt)}</small></td>
          <td>{rule.tokenAddress ? <AddressLink address={rule.tokenAddress} /> : <span>{rule.type === 'price_above' || rule.type === 'price_below' ? 'Native ETH' : 'All indexed ERC-20 tokens'}</span>}{rule.walletAddress && <div className={styles.wallet}><small className="muted">Wallet </small><AddressLink address={rule.walletAddress} /></div>}</td>
          <td title={rule.thresholdUsd ?? undefined}>{rule.thresholdUsd === null ? 'Not applicable' : formatUsd(rule.thresholdUsd)}</td>
          <td><Badge>{rule.enabled ? 'Enabled' : 'Disabled'}</Badge></td>
          <td><div className="actions"><Button variant="ghost" disabled={busy !== null} onClick={() => void toggle(rule)}>{busy === rule.id ? 'Saving...' : rule.enabled ? 'Disable' : 'Enable'}</Button><Button variant="ghost" onClick={() => setEditing(rule)}>Edit</Button><Button variant="ghost" onClick={() => setDeleting(rule)}>Delete</Button></div></td>
        </tr>)}</tbody></Table>
        <Pagination page={page} totalPages={rules.data.totalPages} onPageChange={next => router.push(`/alerts?page=${next}&eventsPage=${eventPage}`)} />
      </>}
    </Card>
    <Card title="Event history" action={events.data ? <Badge>{unread} unread on this page</Badge> : undefined}>
      <p className="muted">Events refresh every 30 seconds. The unread count covers the displayed page.</p>
      {events.error ? <ErrorState error={events.error} retry={events.reload} /> : !events.data ? <Skeleton /> : !events.data.items.length ? <EmptyState title="No alert events yet" description="Events appear after an enabled rule observes a matching condition." /> : <>
        <div className={styles.events}>{events.data.items.map(event => {
          const type = eventType(event) ?? rules.data?.items.find(rule => rule.id === event.alertId)?.type;
          return <article key={event.id} className={`${styles.event} ${event.readAt === null ? styles.unread : ''}`}>
            <div className={styles.eventHeader}><div><div className="actions"><strong>{event.title}</strong>{event.readAt === null && <Badge>Unread</Badge>}{type && <Badge>{alertTypeLabels[type]}</Badge>}</div><time dateTime={event.triggeredAt} className="muted">{formatDateTime(event.triggeredAt)}</time></div>{event.readAt === null ? <Button variant="secondary" disabled={busy !== null} onClick={() => void markRead(event.id)}>{busy === event.id ? 'Saving...' : 'Mark as read'}</Button> : <span className="muted">Read</span>}</div>
            {event.message && <p>{event.message}</p>}<AlertEventDetails event={event} />
          </article>;
        })}</div>
        <Pagination page={eventPage} totalPages={events.data.totalPages} onPageChange={next => router.push(`/alerts?page=${page}&eventsPage=${next}`)} />
      </>}
    </Card>
    {creating && <Modal title="Create alert" onClose={() => setCreating(false)}><AlertForm onSubmit={async input => { await intelligenceApi.createAlert(input); setCreating(false); rules.reload(); notify('Alert created.', 'success'); }} /></Modal>}
    {editing && <Modal title="Edit alert" onClose={() => setEditing(null)}><AlertForm initial={editing} onSubmit={async input => { await intelligenceApi.updateAlert(editing.id, alertUpdate(input)); setEditing(null); rules.reload(); notify('Alert updated.', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title="Delete alert?" description="The rule and its stored events will be removed." confirmLabel="Delete alert" onClose={() => setDeleting(null)} onConfirm={async () => { await intelligenceApi.deleteAlert(deleting.id); setDeleting(null); if (rules.data?.items.length === 1 && page > 1) router.push(`/alerts?page=${page - 1}&eventsPage=${eventPage}`); else rules.reload(); events.reload(); notify('Alert deleted.', 'success'); }} />}
  </div>;
}
