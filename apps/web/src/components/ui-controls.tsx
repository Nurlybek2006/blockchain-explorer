'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui-base';
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-body"><div className="card-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" onClick={onClose} aria-label="Close dialog">×</Button></div>{children}</div>
  </dialog>;
}
export function Tabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return <div className="tabs" role="tablist" aria-label="View"><>{items.map((item, index) => <button type="button" role="tab" key={item.id} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction) { event.preventDefault(); const target = items[(index + direction + items.length) % items.length]; onChange(target.id); const sibling = event.currentTarget.parentElement?.querySelectorAll('button')[(index + direction + items.length) % items.length]; sibling?.focus(); }
  }}>{item.label}</button>)}</></div>;
}
export function Pagination({ page, totalPages, onPageChange, href }: { page: number; totalPages: number; onPageChange?: (page: number) => void; href?: (page: number) => string }) {
  const previous = Math.max(1, page - 1), next = Math.min(totalPages, page + 1);
  return <nav className="pagination" aria-label="Pagination"><span className="muted">Page {page} of {Math.max(1, totalPages)}</span><div className="actions">
    {href ? <><Link className={`button button-secondary ${page <= 1 ? 'disabled-link' : ''}`} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={href(previous)}>← Previous</Link><Link className={`button button-secondary ${page >= totalPages ? 'disabled-link' : ''}`} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : undefined} href={href(next)}>Next →</Link></> : <><Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange?.(previous)}>← Previous</Button><Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange?.(next)}>Next →</Button></>}
  </div></nav>;
}
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle'); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() { try { await navigator.clipboard.writeText(value); setState('copied'); } catch { setState('failed'); }
    if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 2000); }
  return <button type="button" className="copy-button" onClick={() => void copy()} aria-label={label === 'Copy' ? `Copy ${value.length > 128 ? `${value.slice(0, 128)}…` : value}` : label} title={label}><span aria-hidden="true">{state === 'copied' ? '✓' : '⧉'}</span><span className="sr-only" aria-live="polite">{state === 'failed' ? 'Clipboard unavailable. Select and copy the text.' : state === 'copied' ? 'Copied' : label}</span></button>;
}
