'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { parseExplorerSearch } from '@/lib/utils/search';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { ApiError, errorMessage } from '@/lib/api/client';
import styles from './explorer.module.css';

export function SearchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    const result = parseExplorerSearch(query);
    if (result.kind === 'invalid') { setMessage(result.message); return; }
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setMessage(''); setSearching(true);
    try { const resolved = await advancedExplorerApi.search(result.value, request.signal); if (!request.signal.aborted) router.push(resolved.destination); }
    catch (error) { if (!request.signal.aborted) setMessage(error instanceof ApiError && error.status === 404 ? 'No indexed match was found on this network.' : errorMessage(error)); }
    finally { if (!request.signal.aborted) setSearching(false); }
  }
  return <form className={`${styles.search} ${compact ? styles.compactSearch : ''}`} onSubmit={(event) => {
    event.preventDefault();
    void search();
  }}>
    <div className={styles.searchRow}>
      <label className={styles.visuallyHidden} htmlFor={id}>Search the blockchain</label>
      <Input id={id} type="search" value={query} onChange={(event) => { setQuery(event.target.value); if (message) setMessage(''); }} placeholder={compact ? 'Search blocks, transactions, addresses…' : 'Search by block, transaction hash, address or token'} aria-describedby={message ? `${id}-error` : undefined} aria-invalid={Boolean(message)} autoComplete="off" />
      <Button type="submit" disabled={searching} aria-label="Search blockchain">{searching ? 'Finding…' : compact ? 'Go' : 'Search'}</Button>
    </div>
    {message && <p id={`${id}-error`} role="alert" className={styles.searchError}>{message}</p>}
  </form>;
}
