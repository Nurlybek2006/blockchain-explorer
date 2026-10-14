import type { AlertEventResponse, AlertType } from '@blockchain-explorer/contracts';
import { AddressLink, HashLink } from '@/components/ui';
import { formatDateTime, formatUsd } from '@/lib/format';
import { isAlertType } from '@/lib/api/intelligence.decoder';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function payloadRecord(value: unknown): Record<string, unknown> | null { return isRecord(value) ? value : null; }
export function eventType(event: AlertEventResponse): AlertType | null {
  const payload = payloadRecord(event.payload);
  if (typeof payload?.type === 'string' && isAlertType(payload.type)) return payload.type;
  return null;
}
function text(record: Record<string, unknown>, key: string): string | null { return typeof record[key] === 'string' ? record[key] : null; }
export function AlertEventDetails({ event }: { event: AlertEventResponse }) {
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
  return <details><summary>Event details</summary><dl className="profile-grid">
    {validHash && <><dt>Transaction</dt><dd><HashLink hash={transactionHash} /></dd></>}
    {validAddress(tokenAddress) && <><dt>Token</dt><dd><AddressLink address={tokenAddress} /></dd></>}
    {validAddress(fromAddress) && <><dt>From</dt><dd><AddressLink address={fromAddress} /></dd></>}
    {validAddress(toAddress) && <><dt>To</dt><dd><AddressLink address={toAddress} /></dd></>}
    {priceUsd !== null && <><dt>Observed price</dt><dd title={`${priceUsd} USD`}>{formatUsd(priceUsd)}</dd></>}
    {thresholdUsd !== null && <><dt>Threshold</dt><dd title={`${thresholdUsd} USD`}>{formatUsd(thresholdUsd)}</dd></>}
    {valueUsd !== null && <><dt>Transfer reference value</dt><dd title={`${valueUsd} USD`}>{formatUsd(valueUsd)}</dd></>}
    {fetchedAt !== null && <><dt>Price timestamp</dt><dd>{formatDateTime(fetchedAt)}</dd></>}
    {payload.valuationBasis === 'current_price' && <><dt>Valuation basis</dt><dd>Current token price; not historical block price</dd></>}
  </dl></details>;
}
