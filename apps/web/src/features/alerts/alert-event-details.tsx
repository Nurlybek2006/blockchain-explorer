'use client';

import type { AlertEventResponse } from '@blockchain-explorer/contracts';
import { AddressLink, HashLink } from '@/components/ui';
import { formatDateTime, formatUsd } from '@/lib/format';
import { useTranslation } from '@/hooks/use-translation';
import { payloadRecord, payloadText as text } from './alert-event-display';
export function AlertEventDetails({ event }: { event: AlertEventResponse }) {
  const { t, locale } = useTranslation();
  const payload = payloadRecord(event.payload);
  if (!payload) return null;
  const transactionHash = text(payload, 'transactionHash');
  const tokenAddress = text(payload, 'tokenAddress');
  const fromAddress = text(payload, 'fromAddress');
  const toAddress = text(payload, 'toAddress');
  const priceUsd = text(payload, 'priceUsd');
  const valueUsd = text(payload, 'valueUsd');
  const thresholdUsd = text(payload, 'thresholdUsd');
  const fetchedAt = text(payload, 'priceFetchedAt');
  const validHash = transactionHash !== null && /^0x[\da-f]{64}$/i.test(transactionHash);
  const validAddress = (value: string | null): value is string => value !== null && /^0x[\da-f]{40}$/i.test(value);
  if (!validHash && !validAddress(tokenAddress) && priceUsd === null && valueUsd === null && thresholdUsd === null) return null;
  return <details><summary>{t('alerts.eventDetails')}</summary><dl className="profile-grid">
    {validHash && <><dt>{t('alerts.transaction')}</dt><dd><HashLink hash={transactionHash} /></dd></>}
    {validAddress(tokenAddress) && <><dt>{t('alerts.token')}</dt><dd><AddressLink address={tokenAddress} /></dd></>}
    {validAddress(fromAddress) && <><dt>{t('alerts.from')}</dt><dd><AddressLink address={fromAddress} /></dd></>}
    {validAddress(toAddress) && <><dt>{t('alerts.to')}</dt><dd><AddressLink address={toAddress} /></dd></>}
    {priceUsd !== null && <><dt>{t('alerts.observedPrice')}</dt><dd title={`${priceUsd} USD`}>{formatUsd(priceUsd, locale)}</dd></>}
    {thresholdUsd !== null && <><dt>{t('alerts.threshold')}</dt><dd title={`${thresholdUsd} USD`}>{formatUsd(thresholdUsd, locale)}</dd></>}
    {valueUsd !== null && <><dt>{t('alerts.transferValue')}</dt><dd title={`${valueUsd} USD`}>{formatUsd(valueUsd, locale)}</dd></>}
    {fetchedAt !== null && <><dt>{t('alerts.priceTimestamp')}</dt><dd>{formatDateTime(fetchedAt, locale)}</dd></>}
    {payload.valuationBasis === 'current_price' && <><dt>{t('alerts.valuationBasis')}</dt><dd>{t('alerts.currentPrice')}</dd></>}
  </dl></details>;
}
