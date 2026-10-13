import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsString, Length, Max, Min, ValidateBy, ValidateIf } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import {
  isEthereumAddress,
  type AlertCreateInput, type AlertType, type AlertUpdateInput, type PortfolioHistoryRange,
  type WatchlistCreateInput, type WatchlistItemCreateInput, type WatchlistUpdateInput,
} from '@blockchain-explorer/contracts';

function trim({ value }: { value: unknown }): unknown { return typeof value === 'string' ? value.trim() : value; }
function EthereumAddress(): PropertyDecorator {
  return ValidateBy({ name: 'ethereumAddress', validator: {
    validate: (value: unknown) => typeof value === 'string' && isEthereumAddress(value),
    defaultMessage: () => '$property must be a valid Ethereum address',
  } });
}
function positiveThreshold(value: unknown): boolean {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value) && /[1-9]/.test(value);
}
function PositiveThreshold(): PropertyDecorator {
  return ValidateBy({ name: 'positiveUsdThreshold', validator: {
    validate: positiveThreshold,
    defaultMessage: () => '$property must be a positive decimal string with at most 60 integer and 18 fractional digits',
  } });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validCreateSettings(type: unknown, args?: ValidationArguments): boolean {
  const body: unknown = args?.object;
  if (!isRecord(body)) return false;
  if (type === 'wallet_activity') return typeof body.walletAddress === 'string'
    && isEthereumAddress(body.walletAddress) && body.thresholdUsd === undefined;
  if (type === 'price_above' || type === 'price_below') return positiveThreshold(body.thresholdUsd)
    && (body.walletAddress === undefined || body.walletAddress === null);
  return type === 'whale' && (body.thresholdUsd === undefined || positiveThreshold(body.thresholdUsd));
}

export class PortfolioHistoryQueryDto {
  @IsIn(['24h', '7d', '30d', '90d'])
  range: PortfolioHistoryRange = '7d';
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(1000)
  limit = 100;
}

export class CreateWatchlistDto implements WatchlistCreateInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;
}
export class UpdateWatchlistDto implements WatchlistUpdateInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;
}
export class CreateWatchlistItemDto implements WatchlistItemCreateInput {
  @IsIn(['address', 'token'])
  itemType: 'address' | 'token';
  @Transform(trim)
  @EthereumAddress()
  address: string;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 100)
  label?: string;
}

export class CreateAlertDto implements AlertCreateInput {
  @IsIn(['whale', 'price_above', 'price_below', 'wallet_activity'])
  @ValidateBy({ name: 'alertSettings', validator: { validate: validCreateSettings,
    defaultMessage: () => 'Alert fields do not match the selected alert type',
  } })
  type: AlertType;
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @EthereumAddress()
  walletAddress?: string | null;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @EthereumAddress()
  tokenAddress?: string | null;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @PositiveThreshold()
  thresholdUsd?: string;
}
export class UpdateAlertDto implements AlertUpdateInput {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(['whale', 'price_above', 'price_below', 'wallet_activity'])
  type?: AlertType;
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @EthereumAddress()
  walletAddress?: string | null;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @EthereumAddress()
  tokenAddress?: string | null;
  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @PositiveThreshold()
  thresholdUsd?: string | null;
}
