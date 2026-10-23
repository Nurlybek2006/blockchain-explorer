'use client';
import { useCallback, useState } from 'react';
import type { PortfolioPnlResponse, PortfolioTradeResponse, PortfolioValuedHoldingResponse, WalletActivityItem } from '@blockchain-explorer/contracts/browser';
import { Badge, Button, Card, EmptyState, ErrorState, HashLink, Modal, Pagination, Skeleton, StatCard, Table } from '@/components/ui';
import { useTranslation } from '@/hooks/use-translation';
import { useResource } from '@/hooks/use-resource';
import { portfolioApi } from '@/lib/api/portfolio.api';
import { formatDateTime, formatPercentage, formatTokenAmount, formatUsd } from '@/lib/format';
import type { Locale } from '@/i18n/types';
import { useToast } from '@/providers/toast-provider';
import { changeClass } from './portfolio-display';
import { TradeForm } from './trade-form';
import { ConfirmDialog } from './forms';
import styles from './pnl.module.css';

function signedUsd(value: string | null, locale: Locale): string {
  return `${value !== null && !value.startsWith('-') && /[1-9]/.test(value) ? '+' : ''}${formatUsd(value, locale)}`;
}
export function PnlSummary({ data }: { data: PortfolioPnlResponse }) {
  const { t, locale } = useTranslation();
  const summary = data.summary;
  return <div className="page-stack">
    <div className="stats-grid">
      <StatCard label={t('pnl.invested')} value={<span title={summary.investedUsd ?? undefined}>{formatUsd(summary.investedUsd, locale)}</span>} />
      <StatCard label={t('pnl.current')} value={formatUsd(summary.currentValueUsd, locale)} />
      <StatCard label={t('pnl.profit')} value={<span className={changeClass(summary.totalPnlUsd)}>{signedUsd(summary.totalPnlUsd, locale)}</span>} note={t('pnl.method')} />
      <StatCard label={t('pnl.roi')} value={<span className={changeClass(summary.roiPercent)}>{formatPercentage(summary.roiPercent, locale)}</span>} />
      <StatCard label={t('pnl.realized')} value={<span className={changeClass(summary.realizedPnlUsd)}>{signedUsd(summary.realizedPnlUsd, locale)}</span>} />
      <StatCard label={t('pnl.unrealized')} value={<span className={changeClass(summary.unrealizedPnlUsd)}>{signedUsd(summary.unrealizedPnlUsd, locale)}</span>} />
    </div>
    <p className="muted">{t('pnl.roiDescription')}</p>
    <Badge tone={summary.complete ? 'success' : 'warning'}>{t(summary.complete ? 'pnl.complete' : 'pnl.incomplete')}</Badge>
    {data.entryCount === 0 && <EmptyState title={t('pnl.empty')} description={t('pnl.description')} />}
    <Table label={t('pnl.title')}><thead><tr>
      <th>{t('pnl.asset')}</th><th>{t('pnl.balance')}</th><th>{t('pnl.average')}</th><th>{t('pnl.basis')}</th><th>{t('pnl.price')}</th>
      <th>{t('pnl.current')}</th><th>{t('pnl.realized')}</th><th>{t('pnl.unrealized')}</th><th>{t('pnl.roi')}</th><th>{t('pnl.status')}</th>
    </tr></thead><tbody>{data.assets.map(asset => <tr key={asset.assetKey}>
      <td><strong>{asset.symbol}</strong></td>
      <td className="mono" title={asset.balanceRaw === null ? undefined : formatTokenAmount(asset.balanceRaw, asset.decimals, 255, locale)}>{asset.balanceRaw === null ? '—' : formatTokenAmount(asset.balanceRaw, asset.decimals, 8, locale)}<small className={styles.subline} title={formatTokenAmount(asset.ledgerBalanceRaw, asset.decimals, 255, locale)}>{t('pnl.recordedBalance')}: {formatTokenAmount(asset.ledgerBalanceRaw, asset.decimals, 8, locale)}</small></td>
      <td className="mono" title={asset.averageEntryPriceUsd ?? undefined}>{formatUsd(asset.averageEntryPriceUsd, locale)}</td>
      <td className="mono" title={asset.costBasisUsd ?? undefined}>{formatUsd(asset.costBasisUsd, locale)}</td>
      <td className="mono" title={asset.priceUsd ?? undefined}>{formatUsd(asset.priceUsd, locale)}</td>
      <td className="mono" title={asset.currentValueUsd ?? undefined}>{formatUsd(asset.currentValueUsd, locale)}</td>
      <td className={changeClass(asset.realizedPnlUsd)}>{signedUsd(asset.realizedPnlUsd, locale)}</td>
      <td className={changeClass(asset.unrealizedPnlUsd)}>{signedUsd(asset.unrealizedPnlUsd, locale)}<small className={styles.subline}>{formatPercentage(asset.unrealizedRoiPercent, locale)}</small></td>
      <td className={changeClass(asset.roiPercent)}>{formatPercentage(asset.roiPercent, locale)}</td>
      <td className={styles.status}>{asset.complete ? <Badge tone="success">{t('pnl.complete')}</Badge> : asset.reasons.map(reason => <p className="muted" key={reason}>{t(`pnl.reasons.${reason}`)}</p>)}</td>
    </tr>)}</tbody></Table>
    <p className="muted">{t('pnl.notice')}</p>
  </div>;
}

export function PortfolioPnl({ id, holdings, activity, onActivityHandled, onSaved }: {
  id: string; holdings: PortfolioValuedHoldingResponse[]; activity: WalletActivityItem | null; onActivityHandled(): void; onSaved(): void;
}) {
  const { t, locale } = useTranslation(), { notify } = useToast();
  const [page, setPage] = useState(1), [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PortfolioTradeResponse | null>(null), [removing, setRemoving] = useState<PortfolioTradeResponse | null>(null);
  const pnl = useResource(useCallback((signal: AbortSignal) => portfolioApi.pnl(id, signal), [id]), { pollInterval: 30_000 });
  const journal = useResource(useCallback((signal: AbortSignal) => portfolioApi.trades(id, page, signal), [id, page]), { pollInterval: 30_000 });
  function close() { setCreating(false); setEditing(null); onActivityHandled(); }
  function updated() { pnl.reload(); journal.reload(); onSaved(); notify('pnl.saved'); }
  return <div className="page-stack">
    <Card title={t('pnl.title')} action={<Button onClick={() => setCreating(true)}>{t('pnl.add')}</Button>}>
      {pnl.error ? <ErrorState error={pnl.error} retry={pnl.reload} /> : !pnl.data ? <Skeleton /> : <PnlSummary data={pnl.data} />}
    </Card>
    <Card title={t('pnl.journal')}>
      {journal.error ? <ErrorState error={journal.error} retry={journal.reload} /> : !journal.data ? <Skeleton /> : !journal.data.items.length ? <EmptyState title={t('pnl.noTrades')} description={t('pnl.noTradesDescription')} /> : <>
        <Table label={t('pnl.journal')}><thead><tr><th>{t('pnl.date')}</th><th>{t('pnl.asset')}</th><th>{t('pnl.side')}</th><th>{t('pnl.quantity')}</th><th>{t('pnl.executionPrice')}</th><th>{t('pnl.fee')}</th><th>{t('pnl.reference')}</th><th>{t('pnl.actions')}</th></tr></thead>
          <tbody>{journal.data.items.map(entry => <tr key={entry.id}>
            <td>{formatDateTime(entry.occurredAt, locale)}</td><td>{entry.symbol}</td><td>{t(`pnl.sides.${entry.side}`)}</td>
            <td title={entry.quantityRaw}>{formatTokenAmount(entry.quantityRaw, entry.decimals, 8, locale)}</td>
            <td title={entry.unitPriceUsd ?? undefined}>{formatUsd(entry.unitPriceUsd, locale)}</td><td>{formatUsd(entry.feeUsd, locale)}</td>
            <td>{entry.transactionHash ? <HashLink hash={entry.transactionHash} /> : '—'}</td>
            <td><div className="actions"><Button variant="ghost" onClick={() => setEditing(entry)}>{t('common.edit')}</Button><Button variant="danger" onClick={() => setRemoving(entry)}>{t('common.delete')}</Button></div></td>
          </tr>)}</tbody></Table><Pagination page={page} totalPages={journal.data.totalPages} onPageChange={setPage} />
      </>}
      <p className="muted">{t('pnl.chronologicalHelp')}</p>
    </Card>
    {(creating || editing || activity) && <Modal title={t(editing ? 'pnl.edit' : 'pnl.add')} onClose={close}>
      <TradeForm key={editing?.id ?? activity?.id ?? 'new'} holdings={holdings} initial={editing ?? undefined} activity={activity ?? undefined} onSave={async input => {
        await portfolioApi.saveTrade(id, input, editing?.id); close(); setPage(1); updated();
      }} />
    </Modal>}
    {removing && <ConfirmDialog title={t('pnl.removeTitle')} description={t('pnl.removeDescription')} confirmLabel={t('pnl.remove')} onClose={() => setRemoving(null)} onConfirm={async () => {
      await portfolioApi.deleteTrade(id, removing.id); setRemoving(null);
      if (journal.data?.items.length === 1 && page > 1) setPage(page - 1); updated();
    }} />}
  </div>;
}
