import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import type {
  WatchlistCreateInput,
  WatchlistItemCreateInput,
  WatchlistUpdateInput,
} from '@blockchain-explorer/contracts';
import { IsEthereumAddress } from '../../../common/validators/is-ethereum-address.js';
import { PortfolioOwnerDto } from '../../portfolios/dto/portfolio.dto.js';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateWatchlistDto extends PortfolioOwnerDto implements WatchlistCreateInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;
}

export class UpdateWatchlistDto implements WatchlistUpdateInput {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name!: string;
}

export class CreateWatchlistItemDto implements WatchlistItemCreateInput {
  @IsIn(['address', 'token'])
  itemType!: 'address' | 'token';

  @Transform(trim)
  @IsEthereumAddress()
  address!: string;

  @Transform(trim)
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 100)
  label?: string;
}
