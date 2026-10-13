import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortfolioHttpClient } from '../../common/http/portfolio-http.client.js';
import type {
  PortfolioCreateInput,
  PortfolioDetailResponse,
  PortfolioHoldingResponse,
  PortfolioListResponse,
  PortfolioResponse,
  PortfolioUpdateInput,
} from '@blockchain-explorer/contracts';
import {
  decodeHoldings,
  decodePortfolio,
  decodePortfolioDetail,
  decodePortfolioList,
} from './portfolio-response.decoder.js';

@Injectable()
export class PortfolioClient extends PortfolioHttpClient {
  constructor(config: ConfigService) { super(config); }

  async create(userId: string, input: PortfolioCreateInput): Promise<PortfolioResponse> {
    return decodePortfolio(await this.request('POST', '/internal/portfolios', undefined, {
      userId,
      name: input.name,
      walletAddress: input.walletAddress,
      ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    }));
  }

  async list(userId: string, page: number, limit: number): Promise<PortfolioListResponse> {
    return decodePortfolioList(await this.request('GET', '/internal/portfolios', { userId, page, limit }));
  }

  async detail(userId: string, id: string): Promise<PortfolioDetailResponse> {
    return decodePortfolioDetail(await this.request('GET', this.path(id), { userId }));
  }

  async update(userId: string, id: string, input: PortfolioUpdateInput): Promise<PortfolioResponse> {
    return decodePortfolio(await this.request('PATCH', this.path(id), { userId }, { name: input.name }));
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.request('DELETE', this.path(id), { userId });
  }

  async holdings(userId: string, id: string): Promise<PortfolioHoldingResponse[]> {
    return decodeHoldings(await this.request('GET', `${this.path(id)}/holdings`, { userId }));
  }

  private path(id: string): string {
    return `/internal/portfolios/${encodeURIComponent(id)}`;
  }

}
