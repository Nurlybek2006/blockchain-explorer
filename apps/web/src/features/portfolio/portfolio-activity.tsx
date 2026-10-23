'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  decodeWalletActivity,
  type WalletActivityItem,
} from '@blockchain-explorer/contracts/browser';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
} from '@/components/ui';
import { apiRequest } from '@/lib/api/client';
import { useResource } from '@/hooks/use-resource';
import { useTranslation } from '@/hooks/use-translation';
import {
  formatDateTime,
  formatTokenAmount,
} from '@/lib/format';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import styles from './activity.module.css';

const messages = {
  kk: {
    title: 'Портфель белсенділігі',
    received: 'Келіп түсті',
    sent: 'Жіберілді',
    self: 'Өзіне аудару',
    from: 'Кімнен',
    to: 'Кімге',
    details: 'Транзакцияны ашу',
    refresh: 'Жаңарту',
    empty: 'Индекстелген аударым табылмады',
    emptyDescription:
      'Осы мекенжайға қатысты аударымдар индекстелгенде мұнда пайда болады.',
    coverage:
      'Тек индекстелген блоктардағы сәтті ETH және ERC-20 аударымдары көрсетіледі. Internal ETH calls пен gas шығыны кірмейді.',
    raw: 'шикі бірлік',
    token: 'Токен',
  },
  en: {
    title: 'Portfolio Activity',
    received: 'Received',
    sent: 'Sent',
    self: 'Self transfer',
    from: 'From',
    to: 'To',
    details: 'View transaction',
    refresh: 'Refresh',
    empty: 'No indexed transfers found',
    emptyDescription:
      'Transfers involving this address will appear as they are indexed.',
    coverage:
      'Shows successful ETH and ERC-20 transfers from indexed blocks. Internal ETH calls and gas fees are excluded.',
    raw: 'raw units',
    token: 'Token',
  },
} as const;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function PortfolioActivity({
  address,
  onRecord,
}: {
  address: string;
  onRecord?: (item: WalletActivityItem) => void;
}) {
  const { locale, t } = useTranslation();
  const text = messages[locale];
  const [page, setPage] = useState(1);
  const normalized = address.toLowerCase();

  const load = useCallback(
    (signal: AbortSignal) =>
      apiRequest(
        `/address/${encodeURIComponent(normalized)}/activity`,
        {
          query: { page, limit: 10 },
          signal,
          decode: value => {
            const result = decodeWalletActivity(value);

            if (
              result.address !== normalized ||
              result.pagination.page !== page ||
              result.pagination.limit !== 10
            ) {
              throw new Error('Activity response mismatch');
            }

            return result;
          },
        },
      ),
    [normalized, page],
  );

  const resource = useResource(load, {
    pollInterval: 30_000,
  });

  // New canonical blocks and reorgs may change the activity.
  useRealtimeRefresh(
    useCallback(
      event => event.type !== 'token.transfer.indexed',
      [],
    ),
    resource.reload,
  );

  function amount(item: WalletActivityItem): string {
    if (item.decimals === null) {
      return `${item.amountRaw} ${text.raw}`;
    }

    return formatTokenAmount(
      item.amountRaw,
      item.decimals,
      8,
      locale,
    );
  }

  return (
    <Card
      title={text.title}
      action={
        <Button
          variant="ghost"
          onClick={resource.reload}
        >
          {text.refresh}
        </Button>
      }
    >
      <p className={styles.coverage}>{text.coverage}</p>

      {resource.error ? (
        <ErrorState
          error={resource.error}
          retry={resource.reload}
        />
      ) : !resource.data ? (
        <div className="page-stack">
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        <>
          {resource.data.items.length === 0 ? (
            <EmptyState
              title={text.empty}
              description={text.emptyDescription}
            />
          ) : (
            <ul className={styles.list}>
              {resource.data.items.map(item => {
                const received = item.direction === 'received';
                const self = item.direction === 'self';

                const label = self
                  ? text.self
                  : received
                    ? text.received
                    : text.sent;

                const counterparty = received
                  ? item.fromAddress
                  : item.toAddress;

                const symbol =
                  item.symbol?.trim() ||
                  (item.tokenAddress
                    ? shortAddress(item.tokenAddress)
                    : text.token);

                const sign = self ? '' : received ? '+' : '−';

                const tone = self
                  ? styles.self
                  : received
                    ? styles.received
                    : styles.sent;

                return (
                  <li key={item.id}>
                    <Link
                      href={`/tx/${item.transactionHash}`}
                      className={styles.row}
                      aria-label={`${text.details}: ${item.transactionHash}`}
                    >
                      <span
                        className={`${styles.icon} ${tone}`}
                        aria-hidden="true"
                      >
                        {self ? '↔' : received ? '↙' : '↗'}
                      </span>

                      <span className={styles.description}>
                        <strong>{label}</strong>
                        <span
                          className={styles.counterparty}
                          title={counterparty}
                        >
                          {received ? text.from : text.to}
                          {' '}
                          {shortAddress(counterparty)}
                        </span>
                      </span>

                      <span className={styles.values}>
                        <strong
                          className={tone}
                          title={`${item.amountRaw} ${text.raw}`}
                        >
                          {sign}{amount(item)} {symbol}
                        </strong>

                        <time dateTime={item.timestamp}>
                          {formatDateTime(item.timestamp, locale)}
                        </time>
                      </span>

                      <span
                        className={styles.arrow}
                        aria-hidden="true"
                      >
                        →
                      </span>
                    </Link>
                    {onRecord && item.direction !== 'self' && /[1-9]/.test(item.amountRaw) && <Button className={styles.recordButton} variant="ghost" disabled={item.decimals === null} title={item.decimals === null ? t('pnl.needDecimals') : t('pnl.classify')} onClick={() => onRecord(item)}>{t('pnl.classify')}</Button>}
                  </li>
                );
              })}
            </ul>
          )}

          {resource.data.pagination.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={resource.data.pagination.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </Card>
  );
}
