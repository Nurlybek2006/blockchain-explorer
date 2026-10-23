import { Allow, ValidateBy, type ValidationArguments } from 'class-validator';
import { isPortfolioTradeInput, type PortfolioTradeInput, type PortfolioTradeSide } from '@blockchain-explorer/contracts';

export class PortfolioTradeDto implements PortfolioTradeInput {
  @Allow() clientId!: string;
  @Allow() assetKey!: string;
  @Allow() symbol!: string;
  @Allow() decimals!: number;
  @ValidateBy({ name: 'portfolioTrade', validator: { validate: (_value: unknown, args?: ValidationArguments) => isPortfolioTradeInput(args?.object) } })
  side!: PortfolioTradeSide;
  @Allow() quantityRaw!: string;
  @Allow() unitPriceUsd!: string | null;
  @Allow() feeUsd!: string;
  @Allow() occurredAt!: string;
  @Allow() transactionHash!: string | null;
  @Allow() activityId!: string | null;
}
