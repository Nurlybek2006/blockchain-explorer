import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type {
  PortfolioCreateInput,
  PortfolioUpdateInput,
} from '@blockchain-explorer/contracts';
import { IsEthereumAddress } from '../../../common/validators/is-ethereum-address.js';

function trimValue({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class PortfolioOwnerDto {
  @IsUUID()
  userId!: string;
}

export class PortfolioPaginationDto extends PortfolioOwnerDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreatePortfolioDto extends PortfolioOwnerDto implements PortfolioCreateInput {
  @Transform(trimValue)
  @IsString()
  @Length(1, 100)
  name!: string;

  @Transform(trimValue)
  @IsEthereumAddress()
  walletAddress!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  chainId?: number;
}

export class UpdatePortfolioDto implements PortfolioUpdateInput {
  @Transform(trimValue)
  @IsString()
  @Length(1, 100)
  name!: string;
}
