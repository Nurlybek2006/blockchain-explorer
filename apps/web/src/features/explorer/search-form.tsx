'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { parseExplorerSearch } from '@/lib/utils/search';
import styles from './explorer.module.css';

export function SearchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  return <form className={`${styles.search} ${compact ? styles.compactSearch : ''}`} onSubmit={(event) => {
    event.preventDefault();
    const result = parseExplorerSearch(query);
    if (result.kind === 'invalid') { setMessage(result.message); return; }
    setMessage('');
    router.push(result.href);
  }}>
    <div className={styles.searchRow}>
      <label className={styles.visuallyHidden} htmlFor={id}>Search the blockchain</label>
      <Input id={id} type="search" value={query} onChange={(event) => { setQuery(event.target.value); if (message) setMessage(''); }} placeholder={compact ? 'Search blocks, transactions, addresses…' : 'Search by block, transaction hash, address or token'} aria-describedby={message ? `${id}-error` : undefined} aria-invalid={Boolean(message)} autoComplete="off" />
      <Button type="submit" aria-label="Search blockchain">{compact ? 'Go' : 'Search'}</Button>
    </div>
    {message && <p id={`${id}-error`} role="alert" className={styles.searchError}>{message}</p>}
  </form>;
}
