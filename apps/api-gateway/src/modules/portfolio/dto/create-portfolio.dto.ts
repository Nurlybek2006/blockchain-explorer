import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isEthereumAddress } from '@blockchain-explorer/contracts';
import type { PortfolioCreateInput } from '@blockchain-explorer/contracts';

@ValidatorConstraint({ name: 'ethereumAddress', async: false })
export class EthereumAddressConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isEthereumAddress(value);
  }

  defaultMessage(): string {
    return 'walletAddress must be a valid Ethereum address';
  }
}

export class CreatePortfolioDto implements PortfolioCreateInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Validate(EthereumAddressConstraint)
  walletAddress!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  chainId?: number;
}
