import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, ValidateBy, ValidateIf } from 'class-validator';
import type { AlertCreateInput, AlertType, AlertUpdateInput } from '@blockchain-explorer/contracts';
import { IsEthereumAddress } from '../../../common/validators/is-ethereum-address.js';
import { PortfolioOwnerDto } from '../../portfolios/dto/portfolio.dto.js';

export function isPositiveUsdThreshold(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value)
    && /[1-9]/.test(value);
}

function PositiveUsdThreshold(): PropertyDecorator {
  return ValidateBy({
    name: 'positiveUsdThreshold',
    validator: {
      validate: isPositiveUsdThreshold,
      defaultMessage: () => '$property must be a positive decimal string with at most 60 integer and 18 fractional digits',
    },
  });
}

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const alertTypes = ['whale', 'price_above', 'price_below', 'wallet_activity'];

export class CreateAlertDto extends PortfolioOwnerDto implements AlertCreateInput {
  @IsIn(alertTypes)
  type!: AlertType;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsEthereumAddress()
  walletAddress?: string | null;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsEthereumAddress()
  tokenAddress?: string | null;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @PositiveUsdThreshold()
  thresholdUsd?: string;
}

export class UpdateAlertDto implements AlertUpdateInput {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(alertTypes)
  type?: AlertType;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsEthereumAddress()
  walletAddress?: string | null;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsEthereumAddress()
  tokenAddress?: string | null;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @PositiveUsdThreshold()
  thresholdUsd?: string | null;
}
