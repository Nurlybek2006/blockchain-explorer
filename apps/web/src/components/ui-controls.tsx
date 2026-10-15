'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui-base';
import { useTranslation } from '@/hooks/use-translation';
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-body"><div className="card-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" onClick={onClose} aria-label={t('common.closeDialog')}>×</Button></div>{children}</div>
  </dialog>;
}
export function Tabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  return <div className="tabs" role="tablist" aria-label={t('common.view')}><>{items.map((item, index) => <button type="button" role="tab" key={item.id} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction) { event.preventDefault(); const target = items[(index + direction + items.length) % items.length]; onChange(target.id); const sibling = event.currentTarget.parentElement?.querySelectorAll('button')[(index + direction + items.length) % items.length]; sibling?.focus(); }
  }}>{item.label}</button>)}</></div>;
}
export function Pagination({ page, totalPages, onPageChange, href }: { page: number; totalPages: number; onPageChange?: (page: number) => void; href?: (page: number) => string }) {
  const { t } = useTranslation();
  const previous = Math.max(1, page - 1), next = Math.min(totalPages, page + 1);
  return <nav className="pagination" aria-label={t('common.pagination')}><span className="muted">{t('common.pageOf', { page, total: Math.max(1, totalPages) })}</span><div className="actions">
    {href ? <><Link className={`button button-secondary ${page <= 1 ? 'disabled-link' : ''}`} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={href(previous)}>← {t('common.previous')}</Link><Link className={`button button-secondary ${page >= totalPages ? 'disabled-link' : ''}`} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : undefined} href={href(next)}>{t('common.next')} →</Link></> : <><Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange?.(previous)}>← {t('common.previous')}</Button><Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange?.(next)}>{t('common.next')} →</Button></>}
  </div></nav>;
}
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  const copyLabel = label ?? t('common.copy');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle'); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() { try { await navigator.clipboard.writeText(value); setState('copied'); } catch { setState('failed'); }
    if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 2000); }
  return <button type="button" className="copy-button" onClick={() => void copy()} aria-label={label ?? t('common.copyValue', { value: value.length > 128 ? `${value.slice(0, 128)}…` : value })} title={copyLabel}><span aria-hidden="true">{state === 'copied' ? '✓' : '⧉'}</span><span className="sr-only" aria-live="polite">{state === 'failed' ? t('common.clipboardUnavailable') : state === 'copied' ? t('common.copied') : copyLabel}</span></button>;
}
