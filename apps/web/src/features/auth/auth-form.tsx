'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api/client';
import { safeReturnPath, validateCredentials, type CredentialValidationKey } from '@/lib/auth/validation';
import { useTranslation } from '@/hooks/use-translation';
export function AuthForm({ mode, returnTo }: { mode: 'login' | 'register'; returnTo?: string }) {
  const auth = useAuth(); const router = useRouter(); const register = mode === 'register';
  const { t, locale } = useTranslation();
  const [error, setError] = useState<{ key: CredentialValidationKey } | { cause: unknown } | null>(null), [busy, setBusy] = useState(false);
  const destination = safeReturnPath(returnTo);
  useEffect(() => { if (auth.status === 'authenticated') router.replace(destination); }, [auth.status, router, destination]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), email = String(form.get('email') ?? '').trim(), password = String(form.get('password') ?? '');
    const validation = validateCredentials(email, password, register ? String(form.get('confirmPassword') ?? '') : undefined);
    if (validation) { setError({ key: validation }); return; }
    setBusy(true); setError(null);
    try {
      if (register) { const displayName = String(form.get('displayName') ?? '').trim(); await auth.register({ email, password, ...(displayName ? { displayName } : {}) }); }
      else await auth.login({ email, password });
      router.replace(destination);
    } catch (cause) { setError({ cause }); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout"><div className="auth-intro"><span className="eyebrow">{t('auth.workspace')}</span><h1>{t('auth.clarity')}<br /><span>{t('auth.ethereumWallet')}</span></h1><p>{t('auth.introduction')}</p><div className="auth-network"><span className="live-dot" /> {t('auth.network')}</div></div>
    <Card className="auth-card"><h2>{t(register ? 'auth.createAccount' : 'auth.welcome')}</h2><p className="muted">{t(register ? 'auth.registerDescription' : 'auth.loginDescription')}</p>
      <form onSubmit={submit} className="form-grid" noValidate>
        {register && <label className="field">{t('auth.displayName')} <Input name="displayName" autoComplete="name" maxLength={100} placeholder={t('auth.namePlaceholder')} /></label>}
        <label className="field">{t('auth.email')} <Input name="email" type="email" autoComplete="email" required maxLength={320} placeholder={t('auth.emailPlaceholder')} /></label>
        <label className="field">{t('auth.password')} <Input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} /></label>
        {register && <label className="field">{t('auth.confirmPassword')} <Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>}
        {error && <p className="form-error" role="alert">{'key' in error ? t(error.key) : errorMessage(error.cause, locale, mode)}</p>}
        <Button type="submit" disabled={busy || auth.status === 'loading'}>{t(busy ? 'auth.pleaseWait' : register ? 'auth.create' : 'auth.login')} <span aria-hidden="true">↗</span></Button>
      </form><p className="auth-switch">{t(register ? 'auth.hasAccount' : 'auth.newUser')} <Link href={`${register ? '/login' : '/register'}?next=${encodeURIComponent(destination)}`}>{t(register ? 'auth.login' : 'auth.createLink')}</Link></p>
    </Card></div>;
}
