import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
export class PortfolioClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('PORTFOLIO_INTERNAL_URL') ?? 'http://localhost:3002')
      .replace(/\/+$/, '');
    const baseUrl = new URL(this.baseUrl);
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      throw new Error('PORTFOLIO_INTERNAL_URL must use HTTP or HTTPS');
    }
    this.token = config.getOrThrow<string>('INTERNAL_SERVICE_TOKEN');
    this.timeoutMs = Number(config.get<string | number>('PORTFOLIO_HTTP_TIMEOUT_MS') ?? 10_000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new Error('PORTFOLIO_HTTP_TIMEOUT_MS must be an integer between 1 and 60000');
    }
  }

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

  private async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    query?: Record<string, string | number>,
    body?: Record<string, string | number>,
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'x-internal-service-token': this.token,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: 'error',
      });

      // Error responses can contain infrastructure details; never forward their raw body.
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 400) throw new BadRequestException('Invalid portfolio request');
      if (response.status === 404) throw new NotFoundException('Portfolio not found');
      if (response.status === 409) throw new ConflictException('A portfolio already exists for this wallet and chain');
      if (response.status === 503) throw new ServiceUnavailableException('Portfolio service unavailable');
      if (!response.ok) throw new BadGatewayException('Portfolio service request failed');

      if (method === 'DELETE') {
        if (response.status !== 204) {
          throw new BadGatewayException('Portfolio service returned an invalid response');
        }
        return undefined;
      }

      const text = await response.text();
      try {
        const parsed: unknown = JSON.parse(text);
        return parsed;
      } catch {
        throw new BadGatewayException('Portfolio service returned an invalid response');
      }
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Portfolio service unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
