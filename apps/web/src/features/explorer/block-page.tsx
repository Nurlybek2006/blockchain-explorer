'use client';

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
import styles from './explorer.module.css';

export function BlockPage({ number }: { number: string }) {
  const load = useCallback((signal: AbortSignal) => explorerApi.block(number, signal), [number]);
  const resource = useResource(load);
  const blockNumber = BigInt(number);
  return <div className={styles.stack}><PageHeading eyebrow="EXPLORER" title={`Block #${formatBlockNumber(number)}`} description="Block information and the transactions included in it." action={<div className={styles.actions}>{blockNumber > BigInt(0) && <Link className={styles.pillLink} href={`/blocks/${blockNumber - BigInt(1)}`} aria-label="Previous block">← Previous</Link>}<Link className={styles.pillLink} href={`/blocks/${blockNumber + BigInt(1)}`} aria-label="Next block">Next →</Link></div>} /><ResourceView {...resource} retry={resource.reload} name="Block">{(block) => <>
    <Card title="Overview" action={<Badge tone="success">Indexed</Badge>}><DetailFields fields={[
      { label: 'Block height', value: formatBlockNumber(block.number) },
      { label: 'Timestamp', value: <time dateTime={block.timestamp}>{formatDateTime(block.timestamp)}</time> },
      { label: 'Transactions', value: formatBigInteger(String(block.transactionCount)) },
      { label: 'Miner / proposer', value: block.miner ? <AddressLink address={block.miner} full /> : 'Unavailable' },
      { label: 'Gas used', value: formatGas(block.gasUsed) },
      { label: 'Gas limit', value: formatGas(block.gasLimit) },
      { label: 'Base fee', value: block.baseFeePerGas === null ? 'Unavailable' : `${formatTokenAmount(block.baseFeePerGas, 9, 9)} Gwei` },
      { label: 'Size', value: block.size === null ? 'Unavailable' : `${formatBigInteger(String(block.size))} bytes` },
      { label: 'Block hash', value: <CopyValue value={block.hash} /> },
      { label: 'Parent hash', value: <CopyValue value={block.parentHash} /> },
      ...[{ label: 'Transactions root', value: block.transactionsRoot }, { label: 'State root', value: block.stateRoot }, { label: 'Receipts root', value: block.receiptsRoot }].map(({ label, value }) => ({ label, value: value === null ? 'Unavailable' : <CopyValue value={value} /> })),
      { label: 'Extra data', value: <span className={styles.mono}>{block.extraData ?? 'Unavailable'}</span> },
    ]} /></Card>
    <Card title={`Transactions (${block.transactions.length})`}><TransactionsTable transactions={block.transactions} /></Card>
  </>}</ResourceView></div>;
}
