'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth.api';
import { getApiErrorKey } from '@/i18n/errors';
import { useResource } from '@/hooks/use-resource';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Badge, Button, Card, ErrorState, Modal, PageHeading, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/hooks/use-translation';
export function Profile() {
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => authApi.me(signal), []); const resource = useResource(load);
  const auth = useAuth(), { notify } = useToast(), router = useRouter(); const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  async function logout(all = false) { setBusy(true); try { if (all) await auth.logoutAll(); else await auth.logout(); notify(all ? 'settings.loggedOutAll' : 'settings.loggedOut'); router.replace('/login'); }
    catch (error) { notify(getApiErrorKey(error), 'error'); } finally { setBusy(false); setConfirm(false); } }
  return <div className="page-stack"><PageHeading eyebrow={t('settings.account')} title={t('settings.title')} description={t('settings.description')} />
    {resource.loading ? <Skeleton /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : resource.data && <Card title={t('settings.details')}><dl className="profile-grid"><dt>{t('auth.displayName')}</dt><dd>{resource.data.displayName ?? t('settings.notProvided')}</dd><dt>{t('auth.email')}</dt><dd>{resource.data.email}</dd><dt>{t('settings.role')}</dt><dd><Badge>{t(resource.data.role === 'user' ? 'settings.roles.user' : resource.data.role === 'admin' ? 'settings.roles.admin' : 'settings.roles.unknown')}</Badge></dd><dt>{t('settings.created')}</dt><dd>{formatDateTime(resource.data.createdAt, locale)}</dd><dt>{t('settings.lastLogin')}</dt><dd>{formatDateTime(resource.data.lastLoginAt, locale)}</dd></dl></Card>}
    <Card title={t('settings.sessions')}><p className="muted">{t('settings.sessionsDescription')}</p><div className="actions" style={{ marginTop: 20 }}><Button variant="secondary" disabled={busy} onClick={() => void logout()}>{t('settings.logout')}</Button><Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>{t('settings.logoutAll')}</Button></div></Card>
    {confirm && <Modal title={t('settings.logoutAllTitle')} onClose={() => { if (!busy) setConfirm(false); }}><div className="form-grid"><p className="muted">{t('settings.logoutAllDescription')}</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>{t('portfolio.cancel')}</Button><Button variant="danger" disabled={busy} onClick={() => void logout(true)}>{t(busy ? 'settings.loggingOut' : 'settings.logoutEverywhere')}</Button></div></div></Modal>}
  </div>;
}
