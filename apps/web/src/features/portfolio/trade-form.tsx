'use client';
import { useState, type FormEvent } from 'react';
import { isPortfolioTradeInput, isPortfolioTradeSide, tradeQuantityRaw, type PortfolioTradeInput, type PortfolioTradeResponse, type PortfolioValuedHoldingResponse, type WalletActivityItem } from '@blockchain-explorer/contracts/browser';
import { Button, Input } from '@/components/ui';
import { useTranslation } from '@/hooks/use-translation';
import { errorMessage } from '@/lib/api/client';

export function rawQuantityText(raw: string, decimals: number): string {
  const text = raw.padStart(decimals + 1, '0');
  return decimals ? `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/\.?0+$/, '') : text;
}
export function tradeInputFromForm(form: FormData, clientId: string, activityId: string | null): PortfolioTradeInput | null {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  const decimal = (key: string) => text(key).replace(',', '.');
  const decimals = /^\d{1,3}$/.test(text('decimals')) ? Number(text('decimals')) : -1;
  const quantityRaw = tradeQuantityRaw(decimal('quantity'), decimals), side = text('side');
  const suppliedTime = text('occurredAt').length === 16 ? `${text('occurredAt')}:00` : text('occurredAt');
  const occurredAt = new Date(`${suppliedTime}Z`);
  if (quantityRaw === null || !isPortfolioTradeSide(side) || !Number.isFinite(occurredAt.getTime())) return null;
  if (occurredAt.toISOString().slice(0, 19) !== suppliedTime.slice(0, 19)) return null;
  const noPrice = side === 'transfer_out' || side === 'fee';
  const input = { clientId, assetKey: text('assetKey').toLowerCase(), symbol: text('symbol'), decimals, side, quantityRaw,
    unitPriceUsd: noPrice ? null : decimal('unitPriceUsd'), feeUsd: noPrice ? '0' : decimal('feeUsd'),
    occurredAt: occurredAt.toISOString(), transactionHash: text('transactionHash').toLowerCase() || null, activityId };
  return isPortfolioTradeInput(input) ? input : null;
}

export function TradeForm({ holdings, initial, activity, onSave }: {
  holdings: PortfolioValuedHoldingResponse[]; initial?: PortfolioTradeResponse; activity?: WalletActivityItem;
  onSave(input: PortfolioTradeInput): Promise<void>;
}) {
  const { t, locale } = useTranslation();
  const [clientId] = useState(() => initial?.clientId ?? crypto.randomUUID());
  const [initialTime] = useState(() => (initial?.occurredAt ?? activity?.timestamp ?? new Date().toISOString()).replace(/Z$/, ''));
  const initialKey = initial?.assetKey ?? (activity?.tokenAddress ? `erc20:${activity.tokenAddress}` : 'native:eth');
  const meta = holdings.find(h => h.assetKey === initialKey);
  const [assetKey, setAssetKey] = useState(initialKey);
  const [symbol, setSymbol] = useState(initial?.symbol ?? activity?.symbol ?? meta?.symbol ?? (initialKey === 'native:eth' ? 'ETH' : 'ERC-20'));
  const [decimals, setDecimals] = useState(String(initial?.decimals ?? activity?.decimals ?? meta?.decimals ?? 18));
  const [side, setSide] = useState(initial?.side ?? (activity ? activity.direction === 'received' ? 'transfer_in' : 'transfer_out' : 'buy'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ invalid: true } | { cause: unknown } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const input = tradeInputFromForm(new FormData(event.currentTarget), clientId, initial?.activityId ?? activity?.id ?? null);
    if (!input) { setError({ invalid: true }); return; }
    setBusy(true); setError(null);
    try { await onSave(input); } catch (cause) { setError({ cause }); } finally { setBusy(false); }
  }
  return <form className="form-grid" onSubmit={submit} noValidate>
    <p className="muted">{t('pnl.entryHelp')}</p>
    {!activity && !initial && <label className="field">{t('pnl.chooseAsset')}<select className="input" value={holdings.some(h => h.assetKey === assetKey) ? assetKey : ''} onChange={event => {
      const holding = holdings.find(h => h.assetKey === event.target.value);
      if (holding) { setAssetKey(holding.assetKey); setSymbol(holding.symbol); setDecimals(String(holding.decimals)); }
      else { setAssetKey('erc20:'); setSymbol(''); setDecimals('18'); }
    }}><option value="">{t('pnl.customAsset')}</option>{holdings.map(h => <option key={h.assetKey} value={h.assetKey}>{h.symbol}</option>)}</select></label>}
    <label className="field">{t('pnl.assetKey')}<Input name="assetKey" value={assetKey} onChange={event => setAssetKey(event.target.value)} readOnly={!!activity || !!initial} maxLength={128} /><small className="muted">{t('pnl.assetKeyHelp')}</small></label>
    <label className="field">{t('pnl.symbol')}<Input name="symbol" value={symbol} onChange={event => setSymbol(event.target.value)} maxLength={64} /></label>
    <label className="field">{t('pnl.decimals')}<Input name="decimals" inputMode="numeric" value={decimals} onChange={event => setDecimals(event.target.value)} readOnly={!!activity || !!initial} maxLength={3} /></label>
    <label className="field">{t('pnl.side')}<select className="input" name="side" value={side} onChange={event => { if (isPortfolioTradeSide(event.target.value)) setSide(event.target.value); }}>
      {(['buy', 'sell', 'transfer_in', 'transfer_out', 'fee'] as const).map(value => <option key={value} value={value}>{t(`pnl.sides.${value}`)}</option>)}
    </select></label>
    <label className="field">{t('pnl.quantity')}<Input name="quantity" inputMode="decimal" maxLength={334} readOnly={!!activity} defaultValue={initial ? rawQuantityText(initial.quantityRaw, initial.decimals) : activity?.decimals !== null && activity ? rawQuantityText(activity.amountRaw, activity.decimals) : ''} /><small className="muted">{t('pnl.amountHelp')}</small></label>
    {side !== 'transfer_out' && side !== 'fee' && <><label className="field">{t('pnl.executionPrice')}<Input name="unitPriceUsd" inputMode="decimal" maxLength={79} defaultValue={initial?.unitPriceUsd ?? ''} /></label><label className="field">{t('pnl.fee')}<Input name="feeUsd" inputMode="decimal" maxLength={79} defaultValue={initial?.feeUsd ?? '0'} /></label></>}
    {side === 'transfer_out' && <p className="muted">{t('pnl.transferOutHelp')}</p>}
    {side === 'fee' && <p className="muted">{t('pnl.feeAssetHelp')}</p>}
    <label className="field">{t('pnl.date')}<Input name="occurredAt" type="datetime-local" step="0.001" defaultValue={initialTime} /></label>
    <label className="field">{t('pnl.hash')}<Input name="transactionHash" maxLength={66} readOnly={!!activity} defaultValue={initial?.transactionHash ?? activity?.transactionHash ?? ''} /></label>
    <p className="muted">{t('pnl.chronologicalHelp')}</p>
    {error && <p role="alert" className="form-error">{'invalid' in error ? t('pnl.validation.input') : errorMessage(error.cause, locale, 'trade')}</p>}
    <Button type="submit" disabled={busy}>{t(busy ? 'pnl.saving' : 'pnl.save')}</Button>
  </form>;
}
