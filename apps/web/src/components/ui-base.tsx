import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { errorMessage } from '@/lib/api/client';
import { formatAddress, formatHash } from '@/lib/format';
export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button {...props} type={type} className={`button button-${variant} ${className}`} />;
}
export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${className}`} />; }
export function Card({ title, action, className = '', children }: { title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`card ${className}`}>{(title || action) && <div className="card-heading">{title && <h2>{title}</h2>}{action}</div>}{children}</section>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action && <div className="actions">{action}</div>}</div>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status }: { status: 'success' | 'failed' | 'pending' }) { return <Badge tone={status === 'success' ? 'success' : status === 'failed' ? 'danger' : 'warning'}>{status === 'success' ? 'Success' : status === 'failed' ? 'Failed' : 'Pending'}</Badge>; }
export function Table({ children, label = 'Data table' }: { children: ReactNode; label?: string }) { return <div className="table-wrap" tabIndex={0} role="region" aria-label={label}><table><caption className="sr-only">{label}</caption>{children}</table></div>; }
export function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="skeleton-group" role="status" aria-label="Loading"><span className="sr-only">Loading…</span>{Array.from({ length: rows }, (_, index) => <div className="skeleton" key={index} />)}</div>; }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>{title}</h2>{description && <p className="muted">{description}</p>}{action}</div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="error-state" role="alert"><h2>Unable to load this view</h2><p>{errorMessage(error)}</p>{retry && <Button variant="secondary" onClick={retry}>Try again</Button>}</div>; }
export function AddressLink({ address, full = false, highlight = false }: { address: string; full?: boolean; highlight?: boolean }) { return <Link href={`/address/${address}`} className={`mono text-link ${highlight ? 'highlight' : ''}`} title={address}>{full ? address : formatAddress(address)}</Link>; }
export function HashLink({ hash, href, full = false }: { hash: string; href?: string; full?: boolean }) { return <Link href={href ?? `/tx/${hash}`} className="mono text-link" title={hash}>{full ? hash : formatHash(hash)}</Link>; }
export function StatCard({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) { return <div className="stat-card"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong>{note && <span className="stat-note">{note}</span>}</div>; }
