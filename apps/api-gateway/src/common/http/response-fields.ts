import { BadGatewayException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { PortfolioValuationSummary } from '@blockchain-explorer/contracts';

export function invalidResponse(): never { throw new BadGatewayException('Portfolio service returned an invalid response'); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function readRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalidResponse();
  return value;
}
export function readString(value: unknown): string { if (typeof value !== 'string') return invalidResponse(); return value; }
export function readNullableString(value: unknown): string | null { return value === null ? null : readString(value); }
export function readBoolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalidResponse(); return value; }
export function readInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalidResponse();
  return value;
}
export function readUuid(value: unknown): string { const id = readString(value); if (!isUUID(id)) return invalidResponse(); return id; }
export function readTimestamp(value: unknown): string {
  const text = readString(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) return invalidResponse();
  return text;
}
export function readNullableTimestamp(value: unknown): string | null { return value === null ? null : readTimestamp(value); }
export function readDecimal(value: unknown, nullable = true, signed = true): string | null {
  if (value === null && nullable) return null;
  const text = readString(value);
  if (!(signed ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(text)) return invalidResponse();
  return text;
}
export function readMoney(value: unknown): string { const text = readDecimal(value, false, false); if (text === null) return invalidResponse(); return text; }
export function decodeValuationSummary(value: unknown): PortfolioValuationSummary {
  const body = readRecord(value);
  return {
    totalValueUsd: readDecimal(body.totalValueUsd, true, false), pricedValueUsd: readMoney(body.pricedValueUsd),
    assetCount: readInteger(body.assetCount), pricedAssetCount: readInteger(body.pricedAssetCount), unpricedAssetCount: readInteger(body.unpricedAssetCount),
    complete: readBoolean(body.complete), change24hUsd: readDecimal(body.change24hUsd), change24hPercent: readDecimal(body.change24hPercent), marketChangeComplete: readBoolean(body.marketChangeComplete), staleAssetCount: readInteger(body.staleAssetCount),
  };
}
