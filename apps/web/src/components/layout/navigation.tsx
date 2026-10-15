'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { getApiErrorKey } from '@/i18n/errors';
import { useTranslation } from '@/hooks/use-translation';
import { LanguageSwitcher } from './language-switcher';
import { SearchForm } from '@/features/explorer/search-form';
import { Button } from '@/components/ui';
import { NetworkStatusWidget } from '@/features/realtime/live-status';
const links = [{ href: '/', key: 'overview', icon: '◈' }, { href: '/blocks', key: 'blocks', icon: '▤' }, { href: '/tokens', key: 'tokens', icon: '◉' }, { href: '/portfolio', key: 'portfolio', icon: '◫' }, { href: '/watchlists', key: 'watchlists', icon: '☆' }, { href: '/alerts', key: 'alerts', icon: '♧' }] as const;
export function Navigation() {
  const { t } = useTranslation();
  const pathname = usePathname(), auth = useAuth(), router = useRouter(), { notify } = useToast();
  const [open, setOpen] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
  async function logout() { setLoggingOut(true); try { await auth.logout(); router.push('/'); notify('navigation.signedOut'); } catch (error) { notify(getApiErrorKey(error), 'error'); } finally { setLoggingOut(false); } }
  return <><header className="app-header"><Link href="/" className="brand" aria-label={t('navigation.home')}><span className="brand-mark" aria-hidden="true">◈</span><span>Blockchain<span className="brand-secondary">Explorer</span></span></Link>
    <div className="header-search"><SearchForm compact /></div><NetworkStatusWidget />
    <div className="header-user">{auth.status === 'authenticated' ? <><Link href="/settings" className="user-link"><span className="avatar">{(auth.user?.displayName ?? auth.user?.email ?? 'U').slice(0, 1).toUpperCase()}</span><span className="user-name">{auth.user?.displayName ?? t('navigation.myAccount')}</span></Link><Button variant="ghost" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? t('navigation.loggingOut') : t('navigation.logout')}</Button></> : auth.status === 'loading' ? <span className="muted">{t('navigation.restoringSession')}</span> : <><Link className="button button-ghost" href="/login">{t('navigation.login')}</Link><Link className="button button-primary" href="/register">{t('navigation.register')} ↗</Link></>}</div>
    <LanguageSwitcher />
    <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(value => !value)} aria-label={open ? t('navigation.closeNavigation') : t('navigation.openNavigation')}>{open ? '×' : '☰'}</button>
  </header>{open && <button className="drawer-backdrop" aria-label={t('navigation.closeNavigation')} type="button" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><p className="nav-label">{t('navigation.workspace')}</p><nav id="main-navigation" aria-label={t('navigation.mainNavigation')}>{links.map(link => {
      const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
      const label = t(`navigation.${link.key}`);
      return <Link key={link.href} href={link.href} aria-label={label} onClick={() => setOpen(false)} className={`nav-link ${active ? 'nav-active' : ''}`} aria-current={active ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">{link.icon}</span><span>{label}</span>{active && <span className="nav-active-dot" />}</Link>;
    })}<Link href="/search" aria-label={t('navigation.search')} className="nav-link" onClick={() => setOpen(false)}><span className="nav-icon" aria-hidden="true">⌕</span><span>{t('navigation.search')}</span></Link></nav><div className="sidebar-bottom"><p className="nav-label">{t('navigation.network')}</p><div className="network-panel"><span className="live-dot" /><div><strong>Ethereum Sepolia</strong><span>{t('navigation.chainId', { id: '11155111' })}</span></div></div><p className="sidebar-note">{t('navigation.networkNote')}</p><Link href="/settings" aria-label={t('navigation.settings')} onClick={() => setOpen(false)} className="nav-link"><span className="nav-icon" aria-hidden="true">⚙</span><span>{t('navigation.settings')}</span></Link><span className="build-label">BLOCKCHAIN EXPLORER / V1</span></div></aside></>;
}
