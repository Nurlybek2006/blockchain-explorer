'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { errorMessage } from '@/lib/api/client';
import { SearchForm } from '@/features/explorer/search-form';
import { Button } from '@/components/ui';
import { NetworkStatusWidget } from '@/features/realtime/live-status';
const links = [{ href: '/', label: 'Overview', icon: '◈' }, { href: '/blocks', label: 'Blocks', icon: '▤' }, { href: '/tokens', label: 'Tokens', icon: '◉' }, { href: '/portfolio', label: 'Portfolio', icon: '◫' }, { href: '/watchlists', label: 'Watchlists', icon: '☆' }, { href: '/alerts', label: 'Alerts', icon: '♧' }];
export function Navigation() {
  const pathname = usePathname(), auth = useAuth(), router = useRouter(), { notify } = useToast();
  const [open, setOpen] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
  async function logout() { setLoggingOut(true); try { await auth.logout(); router.push('/'); notify('Signed out.'); } catch (error) { notify(errorMessage(error), 'error'); } finally { setLoggingOut(false); } }
  return <><header className="app-header"><Link href="/" className="brand" aria-label="Blockchain Explorer home"><span className="brand-mark" aria-hidden="true">◈</span><span>Blockchain<span className="brand-secondary">Explorer</span></span></Link>
    <div className="header-search"><SearchForm compact /></div><NetworkStatusWidget />
    <div className="header-user">{auth.status === 'authenticated' ? <><Link href="/settings" className="user-link"><span className="avatar">{(auth.user?.displayName ?? auth.user?.email ?? 'U').slice(0, 1).toUpperCase()}</span><span className="user-name">{auth.user?.displayName ?? 'My account'}</span></Link><Button variant="ghost" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Signing out…' : 'Sign out'}</Button></> : auth.status === 'loading' ? <span className="muted">Restoring session…</span> : <><Link className="button button-ghost" href="/login">Sign in</Link><Link className="button button-primary" href="/register">Get started ↗</Link></>}</div>
    <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(value => !value)} aria-label={open ? 'Close navigation' : 'Open navigation'}>{open ? '×' : '☰'}</button>
  </header>{open && <button className="drawer-backdrop" aria-label="Close navigation" type="button" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><p className="nav-label">WORKSPACE</p><nav id="main-navigation" aria-label="Main navigation">{links.map(link => {
      const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
      return <Link key={link.href} href={link.href} aria-label={link.label} onClick={() => setOpen(false)} className={`nav-link ${active ? 'nav-active' : ''}`} aria-current={active ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">{link.icon}</span><span>{link.label}</span>{active && <span className="nav-active-dot" />}</Link>;
    })}<Link href="/search" aria-label="Search" className="nav-link" onClick={() => setOpen(false)}><span className="nav-icon" aria-hidden="true">⌕</span><span>Search</span></Link></nav><div className="sidebar-bottom"><p className="nav-label">NETWORK</p><div className="network-panel"><span className="live-dot" /><div><strong>Ethereum Sepolia</strong><span>Chain ID 11155111</span></div></div><p className="sidebar-note">Explore on-chain activity.<br />Prices use ETH market references.</p><Link href="/settings" aria-label="Settings" onClick={() => setOpen(false)} className="nav-link"><span className="nav-icon" aria-hidden="true">⚙</span><span>Settings</span></Link><span className="build-label">BLOCKCHAIN EXPLORER / V1</span></div></aside></>;
}
