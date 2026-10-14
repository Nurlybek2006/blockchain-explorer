'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, Input } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api/client';
import { safeReturnPath, validateCredentials } from '@/lib/auth/validation';
export function AuthForm({ mode, returnTo }: { mode: 'login' | 'register'; returnTo?: string }) {
  const auth = useAuth(); const router = useRouter(); const register = mode === 'register';
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const destination = safeReturnPath(returnTo);
  useEffect(() => { if (auth.status === 'authenticated') router.replace(destination); }, [auth.status, router, destination]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), email = String(form.get('email') ?? '').trim(), password = String(form.get('password') ?? '');
    const validation = validateCredentials(email, password, register ? String(form.get('confirmPassword') ?? '') : undefined);
    if (validation) { setError(validation); return; }
    setBusy(true); setError(null);
    try {
      if (register) { const displayName = String(form.get('displayName') ?? '').trim(); await auth.register({ email, password, ...(displayName ? { displayName } : {}) }); }
      else await auth.login({ email, password });
      router.replace(destination);
    } catch (cause) { setError(cause instanceof ApiError && cause.status === 401 ? 'Incorrect email or password.' : errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout"><div className="auth-intro"><span className="eyebrow">YOUR ON-CHAIN WORKSPACE</span><h1>Clarity for every<br /><span>Ethereum wallet.</span></h1><p>Explore the network. Follow your holdings. Keep an eye on what matters.</p><div className="auth-network"><span className="live-dot" /> Sepolia network · ETH reference prices</div></div>
    <Card className="auth-card"><h2>{register ? 'Create your account' : 'Welcome back'}</h2><p className="muted">{register ? 'Start building your portfolio workspace.' : 'Sign in to your portfolio and alerts.'}</p>
      <form onSubmit={submit} className="form-grid">
        {register && <label className="field">Display name <Input name="displayName" autoComplete="name" maxLength={100} placeholder="Your name" /></label>}
        <label className="field">Email <Input name="email" type="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" /></label>
        <label className="field">Password <Input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={72} /></label>
        {register && <label className="field">Confirm password <Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy || auth.status === 'loading'}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span></Button>
      </form><p className="auth-switch">{register ? 'Already have an account?' : 'New to Blockchain Explorer?'} <Link href={`${register ? '/login' : '/register'}?next=${encodeURIComponent(destination)}`}>{register ? 'Sign in' : 'Create an account'}</Link></p>
    </Card></div>;
}
