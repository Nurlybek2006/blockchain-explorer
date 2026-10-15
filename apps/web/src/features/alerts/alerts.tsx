'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { AlertResponse } from '@blockchain-explorer/contracts';
import { AddressLink, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeading, Pagination, Skeleton, Table } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { getApiErrorKey } from '@/i18n/errors';
import { intelligenceApi } from '@/lib/api/intelligence.api';
import { formatDateTime, formatUsd } from '@/lib/format';
import { useToast } from '@/providers/toast-provider';
import { ConfirmDialog } from '../portfolio/forms';
import { AlertForm } from './alert-form';
import { alertTypeKeys, alertUpdate } from './alert-form-validation';
import { AlertEventDetails } from './alert-event-details';
import { alertEventDisplay, eventType } from './alert-event-display';
import styles from './alerts.module.css';
import { useTranslation } from '@/hooks/use-translation';

export function Alerts({ page, eventPage }: { page: number; eventPage: number }) {
  const { t, locale } = useTranslation();
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
    try { await intelligenceApi.updateAlert(rule.id, { enabled: !rule.enabled }); rules.reload(); notify(rule.enabled ? 'alerts.disabledToast' : 'alerts.enabledToast', 'success'); }
    catch (cause) { notify(getApiErrorKey(cause), 'error'); }
    finally { setBusy(null); }
  }
  async function markRead(id: string) {
    if (busy) return;
    setBusy(id);
    try { await intelligenceApi.markRead(id); events.reload(); notify('alerts.markedRead', 'success'); }
    catch (cause) { notify(getApiErrorKey(cause), 'error'); }
    finally { setBusy(null); }
  }
  return <div className="page-stack">
    <PageHeading eyebrow={t('portfolio.workspace')} title={t('alerts.title')} description={t('alerts.description')} action={<Button onClick={() => setCreating(true)}>{t('alerts.create')}</Button>} />
    <Card title={t('alerts.rules')} action={<Button variant="ghost" onClick={rules.reload}>{t('portfolio.refresh')}</Button>}>
      {rules.error ? <ErrorState error={rules.error} retry={rules.reload} /> : !rules.data ? <Skeleton /> : !rules.data.items.length ? <EmptyState title={t('alerts.noRules')} description={t('alerts.noRulesDescription')} action={<Button onClick={() => setCreating(true)}>{t('alerts.create')}</Button>} /> : <>
        <Table label={t('alerts.rules')}><thead><tr><th>{t('alerts.rule')}</th><th>{t('alerts.assetWallet')}</th><th>{t('alerts.threshold')}</th><th>{t('alerts.status')}</th><th>{t('watchlists.actions')}</th></tr></thead><tbody>{rules.data.items.map(rule => <tr key={rule.id}>
          <td><strong>{t(alertTypeKeys[rule.type])}</strong><small className={styles.timestamp}>{formatDateTime(rule.createdAt, locale)}</small></td>
          <td>{rule.tokenAddress ? <AddressLink address={rule.tokenAddress} /> : <span>{t(rule.type === 'price_above' || rule.type === 'price_below' ? 'alerts.nativeEth' : 'alerts.allTokens')}</span>}{rule.walletAddress && <div className={styles.wallet}><small className="muted">{t('alerts.wallet')} </small><AddressLink address={rule.walletAddress} /></div>}</td>
          <td title={rule.thresholdUsd ?? undefined}>{rule.thresholdUsd === null ? t('alerts.notApplicable') : formatUsd(rule.thresholdUsd, locale)}</td>
          <td><Badge>{t(rule.enabled ? 'alerts.enabled' : 'alerts.disabled')}</Badge></td>
          <td><div className="actions"><Button variant="ghost" disabled={busy !== null} onClick={() => void toggle(rule)}>{t(busy === rule.id ? 'portfolio.saving' : rule.enabled ? 'alerts.disable' : 'alerts.enable')}</Button><Button variant="ghost" onClick={() => setEditing(rule)}>{t('alerts.edit')}</Button><Button variant="ghost" onClick={() => setDeleting(rule)}>{t('alerts.delete')}</Button></div></td>
        </tr>)}</tbody></Table>
        <Pagination page={page} totalPages={rules.data.totalPages} onPageChange={next => router.push(`/alerts?page=${next}&eventsPage=${eventPage}`)} />
      </>}
    </Card>
    <Card title={t('alerts.history')} action={events.data ? <Badge>{t('alerts.unreadCount', { count: unread })}</Badge> : undefined}>
      <p className="muted">{t('alerts.refreshNotice')}</p>
      {events.error ? <ErrorState error={events.error} retry={events.reload} /> : !events.data ? <Skeleton /> : !events.data.items.length ? <EmptyState title={t('alerts.noEvents')} description={t('alerts.noEventsDescription')} /> : <>
        <div className={styles.events}>{events.data.items.map(event => {
          const type = eventType(event) ?? rules.data?.items.find(rule => rule.id === event.alertId)?.type;
          const display = alertEventDisplay(event, locale, type);
          return <article key={event.id} className={`${styles.event} ${event.readAt === null ? styles.unread : ''}`}>
            <div className={styles.eventHeader}><div><div className="actions"><strong>{display.title}</strong>{event.readAt === null && <Badge>{t('alerts.unread')}</Badge>}{type && <Badge>{t(alertTypeKeys[type])}</Badge>}</div><time dateTime={event.triggeredAt} className="muted">{formatDateTime(event.triggeredAt, locale)}</time></div>{event.readAt === null ? <Button variant="secondary" disabled={busy !== null} onClick={() => void markRead(event.id)}>{t(busy === event.id ? 'portfolio.saving' : 'alerts.markRead')}</Button> : <span className="muted">{t('alerts.read')}</span>}</div>
            <p>{display.message}</p><AlertEventDetails event={event} />
          </article>;
        })}</div>
        <Pagination page={eventPage} totalPages={events.data.totalPages} onPageChange={next => router.push(`/alerts?page=${page}&eventsPage=${next}`)} />
      </>}
    </Card>
    {creating && <Modal title={t('alerts.create')} onClose={() => setCreating(false)}><AlertForm onSubmit={async input => { await intelligenceApi.createAlert(input); setCreating(false); rules.reload(); notify('alerts.created', 'success'); }} /></Modal>}
    {editing && <Modal title={t('alerts.editTitle')} onClose={() => setEditing(null)}><AlertForm initial={editing} onSubmit={async input => { await intelligenceApi.updateAlert(editing.id, alertUpdate(input)); setEditing(null); rules.reload(); notify('alerts.updated', 'success'); }} /></Modal>}
    {deleting && <ConfirmDialog title={t('alerts.deleteTitle')} description={t('alerts.deleteDescription')} confirmLabel={t('alerts.deleteConfirm')} onClose={() => setDeleting(null)} onConfirm={async () => { await intelligenceApi.deleteAlert(deleting.id); setDeleting(null); if (rules.data?.items.length === 1 && page > 1) router.push(`/alerts?page=${page - 1}&eventsPage=${eventPage}`); else rules.reload(); events.reload(); notify('alerts.deleted', 'success'); }} />}
  </div>;
}
