'use client';

import { useTranslation } from '@/hooks/use-translation';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { parseExplorerSearch, type ExplorerSearchInvalidCode } from '@/lib/utils/search';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { ApiError, errorMessage } from '@/lib/api/client';
import styles from './explorer.module.css';

type SearchIssue = { kind: 'invalid'; code: ExplorerSearchInvalidCode } | { kind: 'not-found' } | { kind: 'error'; error: unknown };

export function SearchForm({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState('');
  const [issue, setIssue] = useState<SearchIssue | null>(null);
  const message = issue === null ? '' : issue.kind === 'invalid'
    ? t(issue.code === 'too-long' ? 'explorer.search.tooLong' : 'explorer.search.invalid')
    : issue.kind === 'not-found' ? t('explorer.search.noMatch') : errorMessage(issue.error, locale);
  const [searching, setSearching] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    const result = parseExplorerSearch(query);
    if (result.kind === 'invalid') { setIssue(result); return; }
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setIssue(null); setSearching(true);
    try { const resolved = await advancedExplorerApi.search(result.value, request.signal); if (!request.signal.aborted) router.push(resolved.destination); }
    catch (error) { if (!request.signal.aborted) setIssue(error instanceof ApiError && error.status === 404 ? { kind: 'not-found' } : { kind: 'error', error }); }
    finally { if (!request.signal.aborted) setSearching(false); }
  }
  return <form className={`${styles.search} ${compact ? styles.compactSearch : ''}`} onSubmit={(event) => {
    event.preventDefault();
    void search();
  }}>
    <div className={styles.searchRow}>
      <label className={styles.visuallyHidden} htmlFor={id}>{t("explorer.search.title")}</label>
      <Input id={id} type="search" value={query} onChange={(event) => { setQuery(event.target.value); if (issue) setIssue(null); }} placeholder={compact ? t("explorer.search.compactPlaceholder") : t("explorer.search.placeholder")} aria-describedby={message ? `${id}-error` : undefined} aria-invalid={Boolean(message)} autoComplete="off" />
      <Button type="submit" disabled={searching} aria-label={t("explorer.search.aria")}>{searching ? t("explorer.search.finding") : compact ? t("explorer.search.go") : t("explorer.search.submit")}</Button>
    </div>
    {message && <p id={`${id}-error`} role="alert" className={styles.searchError}>{message}</p>}
  </form>;
}
