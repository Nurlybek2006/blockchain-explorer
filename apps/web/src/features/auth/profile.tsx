'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api/auth.api';
import { errorMessage } from '@/lib/api/client';
import { useResource } from '@/hooks/use-resource';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Badge, Button, Card, ErrorState, Modal, PageHeading, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
export function Profile() {
  const load = useCallback((signal: AbortSignal) => authApi.me(signal), []); const resource = useResource(load);
  const auth = useAuth(), { notify } = useToast(), router = useRouter(); const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  async function logout(all = false) { setBusy(true); try { if (all) await auth.logoutAll(); else await auth.logout(); notify(all ? 'All sessions signed out.' : 'Signed out.'); router.replace('/login'); }
    catch (error) { notify(errorMessage(error), 'error'); } finally { setBusy(false); setConfirm(false); } }
  return <div className="page-stack"><PageHeading eyebrow="ACCOUNT" title="Your profile" description="Account details and session controls." />
    {resource.loading ? <Skeleton /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : resource.data && <Card title="Account details"><dl className="profile-grid"><dt>Display name</dt><dd>{resource.data.displayName ?? 'Not provided'}</dd><dt>Email</dt><dd>{resource.data.email}</dd><dt>Role</dt><dd><Badge>{resource.data.role}</Badge></dd><dt>Account created</dt><dd>{formatDateTime(resource.data.createdAt)}</dd><dt>Last sign in</dt><dd>{formatDateTime(resource.data.lastLoginAt)}</dd></dl></Card>}
    <Card title="Sessions"><p className="muted">Sign out on this device or revoke refresh sessions across your devices. Existing access tokens may remain valid until they expire.</p><div className="actions" style={{ marginTop: 20 }}><Button variant="secondary" disabled={busy} onClick={() => void logout()}>Sign out</Button><Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>Sign out all sessions</Button></div></Card>
    {confirm && <Modal title="Sign out all sessions?" onClose={() => { if (!busy) setConfirm(false); }}><div className="form-grid"><p className="muted">This revokes all refresh sessions for your account. You will need to sign in again on each device.</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void logout(true)}>{busy ? 'Signing out…' : 'Sign out everywhere'}</Button></div></div></Modal>}
  </div>;
}
