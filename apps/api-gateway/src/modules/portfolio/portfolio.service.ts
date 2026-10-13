import { Injectable } from '@nestjs/common';
import { normalizeEthereumAddress } from '@blockchain-explorer/contracts';
import type {
  PortfolioCreateInput,
  PortfolioUpdateInput,
} from '@blockchain-explorer/contracts';
import { PortfolioClient } from './portfolio.client.js';

@Injectable()
export class PortfolioService {
  constructor(private readonly client: PortfolioClient) {}

  create(userId: string, input: PortfolioCreateInput) {
    return this.client.create(userId, {
      name: input.name.trim(),
      walletAddress: normalizeEthereumAddress(input.walletAddress),
      ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    });
  }

  list(userId: string, page: number, limit: number) {
    return this.client.list(userId, page, limit);
  }

  detail(userId: string, id: string) {
    return this.client.detail(userId, id);
  }

  update(userId: string, id: string, input: PortfolioUpdateInput) {
    return this.client.update(userId, id, { name: input.name.trim() });
  }

  remove(userId: string, id: string) {
    return this.client.remove(userId, id);
  }

  holdings(userId: string, id: string) {
    return this.client.holdings(userId, id);
  }
}
