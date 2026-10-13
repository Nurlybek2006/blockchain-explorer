import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { isEthereumAddress, normalizeEthereumAddress } from '@blockchain-explorer/contracts';
import { IntelligenceClient } from './intelligence.client.js';

@Controller('prices')
export class PricesController {
  constructor(private readonly client: IntelligenceClient) {}
  @Get('eth')
  ethereum() { return this.client.ethereumPrice(); }
  @Get('token/:address')
  token(@Param('address') address: string) {
    if (!isEthereumAddress(address)) throw new BadRequestException('Invalid Ethereum token address');
    return this.client.tokenPrice(normalizeEthereumAddress(address));
  }
}
