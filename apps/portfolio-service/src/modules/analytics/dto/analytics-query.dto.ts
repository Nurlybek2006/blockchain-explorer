import { Type } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import type { PortfolioHistoryRange } from '@blockchain-explorer/contracts';

export class AnalyticsOwnerDto {
  @IsUUID()
  userId: string;
}

export class PortfolioHistoryQueryDto extends AnalyticsOwnerDto {
  @IsIn(['24h', '7d', '30d', '90d'])
  range: PortfolioHistoryRange = '7d';

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(1000)
  limit = 100;
}
