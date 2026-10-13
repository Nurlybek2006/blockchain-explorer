import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import type { PortfolioUpdateInput } from '@blockchain-explorer/contracts';

export class UpdatePortfolioDto implements PortfolioUpdateInput {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  name!: string;
}
