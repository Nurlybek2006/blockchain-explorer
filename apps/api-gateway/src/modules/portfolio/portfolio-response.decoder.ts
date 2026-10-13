import { BadGatewayException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { isEthereumAddress } from '@blockchain-explorer/contracts';
import type {
  PortfolioDetailResponse,
  PortfolioHoldingResponse,
  PortfolioListResponse,
  PortfolioResponse,
} from '@blockchain-explorer/contracts';

function invalidResponse(): never {
  throw new BadGatewayException('Portfolio service returned an invalid response');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function decodePortfolio(body: unknown): PortfolioResponse {
  if (!isRecord(body)) return invalidResponse();
  const { id, name, walletAddress, chainId, isPrimary, createdAt, updatedAt } = body;
  if (
    typeof id !== 'string' || !isUUID(id)
    || typeof name !== 'string' || name.length < 1 || name.length > 100
    || typeof walletAddress !== 'string' || !isEthereumAddress(walletAddress)
    || !isInteger(chainId, 1, 2_147_483_647)
    || typeof isPrimary !== 'boolean'
    || !isTimestamp(createdAt) || !isTimestamp(updatedAt)
  ) return invalidResponse();

  // Select only the public contract fields, even if an upstream response includes private fields.
  return { id, name, walletAddress, chainId, isPrimary, createdAt, updatedAt };
}

export function decodeHolding(body: unknown): PortfolioHoldingResponse {
  if (!isRecord(body)) return invalidResponse();
  const {
    assetKey, assetType, tokenAddress, symbol, name, decimals,
    balanceRaw, balanceFormatted, lastUpdatedBlock, updatedAt,
  } = body;
  if (
    typeof assetKey !== 'string' || assetKey.length === 0
    || typeof assetType !== 'string' || assetType.length === 0
    || (tokenAddress !== null && (typeof tokenAddress !== 'string' || !isEthereumAddress(tokenAddress)))
    || typeof symbol !== 'string'
    || (name !== null && typeof name !== 'string')
    || !isInteger(decimals, 0, 255)
    || typeof balanceRaw !== 'string' || !/^\d+$/.test(balanceRaw)
    || typeof balanceFormatted !== 'string' || !/^\d+(?:\.\d+)?$/.test(balanceFormatted)
    || (lastUpdatedBlock !== null && (typeof lastUpdatedBlock !== 'string' || !/^\d+$/.test(lastUpdatedBlock)))
    || !isTimestamp(updatedAt)
  ) return invalidResponse();

  return {
    assetKey, assetType, tokenAddress, symbol, name, decimals,
    balanceRaw, balanceFormatted, lastUpdatedBlock, updatedAt,
  };
}

export function decodeHoldings(body: unknown): PortfolioHoldingResponse[] {
  if (!Array.isArray(body)) return invalidResponse();
  return body.map((item: unknown) => decodeHolding(item));
}

export function decodePortfolioDetail(body: unknown): PortfolioDetailResponse {
  const portfolio = decodePortfolio(body);
  if (!isRecord(body)) return invalidResponse();
  return { ...portfolio, holdings: decodeHoldings(body.holdings) };
}

export function decodePortfolioList(body: unknown): PortfolioListResponse {
  if (!isRecord(body)) return invalidResponse();
  const { items, page, limit, total, totalPages } = body;
  if (
    !Array.isArray(items)
    || !isInteger(page, 1) || !isInteger(limit, 1, 100)
    || !isInteger(total, 0) || !isInteger(totalPages, 0)
    || totalPages !== Math.ceil(total / limit)
  ) return invalidResponse();

  return {
    items: items.map((item: unknown) => decodePortfolio(item)),
    page, limit, total, totalPages,
  };
}
