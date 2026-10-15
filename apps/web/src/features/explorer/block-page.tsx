'use client';

import { useTranslation } from '@/hooks/use-translation';
import { pluralCategory } from '@/i18n/translator';
import Link from 'next/link';
import { useCallback } from 'react';
import { Badge, Card, PageHeading } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { explorerApi } from '@/lib/api/explorer.api';
import { formatBigInteger, formatBlockNumber, formatDateTime, formatGas, formatTokenAmount } from '@/lib/format';
import { AddressLink } from '@/components/ui';
import { CopyValue, DetailFields } from './detail-fields';
import { TransactionsTable } from './data-tables';
import { ResourceView } from './resource-view';
import { useRealtimeRefresh } from '@/providers/realtime-provider';
import { affectsReorganizedData } from '@/features/realtime/resource-events';
import styles from './explorer.module.css';

export function BlockPage({ number }: { number: string }) {
  const { t, locale } = useTranslation();
  const load = useCallback((signal: AbortSignal) => explorerApi.block(number, signal), [number]);
  const resource = useResource(load);
  useRealtimeRefresh(affectsReorganizedData, resource.reload);
  const blockNumber = BigInt(number);
  return <div className={styles.stack}><PageHeading eyebrow={t("explorer.labels.explorer")} title={t("explorer.blocks.detailTitle", { number: formatBlockNumber(number, locale) })} description={t("explorer.blocks.detailDescription")} action={<div className={styles.actions}>{blockNumber > BigInt(0) && <Link className={styles.pillLink} href={`/blocks/${blockNumber - BigInt(1)}`} aria-label={t("explorer.blocks.previousAria")}>{t("explorer.blocks.previous")}</Link>}<Link className={styles.pillLink} href={`/blocks/${blockNumber + BigInt(1)}`} aria-label={t("explorer.blocks.nextAria")}>{t("explorer.blocks.next")}</Link></div>} /><ResourceView {...resource} retry={resource.reload} name={t("explorer.labels.block")}>{(block) => <>
    <Card title={t("explorer.labels.overview")} action={<Badge tone="success">{t("explorer.labels.indexed")}</Badge>}><DetailFields fields={[
      { label: t("explorer.fields.blockHeight"), value: formatBlockNumber(block.number, locale) },
      { label: t("explorer.fields.timestamp"), value: <time dateTime={block.timestamp}>{formatDateTime(block.timestamp, locale)}</time> },
      { label: t("explorer.labels.transactions"), value: formatBigInteger(String(block.transactionCount), locale) },
      { label: t("explorer.fields.miner"), value: block.miner ? <AddressLink address={block.miner} full /> : t("explorer.labels.unavailable") },
      { label: t("explorer.fields.gasUsed"), value: formatGas(block.gasUsed, locale) },
      { label: t("explorer.fields.gasLimit"), value: formatGas(block.gasLimit, locale) },
      { label: t("explorer.fields.baseFee"), value: block.baseFeePerGas === null ? t("explorer.labels.unavailable") : `${formatTokenAmount(block.baseFeePerGas, 9, 9, locale)} Gwei` },
      { label: t("explorer.fields.size"), value: block.size === null ? t("explorer.labels.unavailable") : t("explorer.fields.bytes", { count: formatBigInteger(String(block.size), locale) }) },
      { label: t("explorer.fields.blockHash"), value: <CopyValue value={block.hash} /> },
      { label: t("explorer.fields.parentHash"), value: <CopyValue value={block.parentHash} /> },
      ...[{ label: t("explorer.fields.transactionsRoot"), value: block.transactionsRoot }, { label: t("explorer.fields.stateRoot"), value: block.stateRoot }, { label: t("explorer.fields.receiptsRoot"), value: block.receiptsRoot }].map(({ label, value }) => ({ label, value: value === null ? t("explorer.labels.unavailable") : <CopyValue value={value} /> })),
      { label: t("explorer.fields.extraData"), value: <span className={styles.mono}>{block.extraData ?? t("explorer.labels.unavailable")}</span> },
    ]} /></Card>
    <Card title={t(pluralCategory(locale, block.transactions.length) === "one" ? "explorer.blocks.transactionsOne" : "explorer.blocks.transactionsMany", { count: formatBigInteger(block.transactions.length, locale) })}><TransactionsTable transactions={block.transactions} /></Card>
  </>}</ResourceView></div>;
}
