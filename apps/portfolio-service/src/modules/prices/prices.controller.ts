import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, ValidateBy } from 'class-validator';
import { isAssetKey, normalizeAssetKey, normalizeEthereumAddress } from '@blockchain-explorer/contracts';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard.js';
import { PricesService } from './prices.service.js';

export class RefreshPriceDto {
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    try { return normalizeAssetKey(value); } catch { return value; }
  })
  @IsString()
  @ValidateBy({ name: 'isAssetKey', validator: { validate: isAssetKey, defaultMessage: () => 'assetKey must be native:eth or erc20:<Ethereum address>' } })
  assetKey!: string;
}

@Controller('internal/prices')
@UseGuards(InternalServiceGuard)
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('eth')
  ethereum() { return this.prices.getPrice('native:eth'); }

  @Get('token/:address')
  token(@Param('address') address: string) {
    let normalized: string;
    try { normalized = normalizeEthereumAddress(address); } catch { throw new BadRequestException('Invalid Ethereum token address'); }
    return this.prices.getPrice(`erc20:${normalized}`);
  }

  @Post('refresh')
  refresh(@Body() input: RefreshPriceDto) { return this.prices.refreshAsset(input.assetKey); }
}
