import { BadGatewayException, BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { propagationHeaders } from '@blockchain-explorer/observability';

/** Shared transport for the Portfolio Service's internal APIs. */
export class PortfolioHttpClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('PORTFOLIO_INTERNAL_URL') ?? 'http://localhost:3002').replace(/\/+$/, '');
    const url = new URL(this.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('PORTFOLIO_INTERNAL_URL must use HTTP or HTTPS');
    this.token = config.getOrThrow<string>('INTERNAL_SERVICE_TOKEN');
    this.timeoutMs = Number(config.get('PORTFOLIO_HTTP_TIMEOUT_MS') ?? 10_000);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new Error('PORTFOLIO_HTTP_TIMEOUT_MS must be an integer between 1 and 60000');
  }

  protected async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, query?: Record<string, string | number>, body?: object): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const resource = path.startsWith('/internal/portfolios') ? 'Portfolio' : 'Resource';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...propagationHeaders(),
          'x-internal-service-token': this.token,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      if (response.status === 400) throw new BadRequestException(resource === 'Portfolio' ? 'Invalid portfolio request' : 'Invalid request');
      if (response.status === 404) throw new NotFoundException(`${resource} not found`);
      if (response.status === 409) throw new ConflictException(resource === 'Portfolio' ? 'A portfolio already exists for this wallet and chain' : 'Resource already exists');
      if (response.status === 503) throw new ServiceUnavailableException('Portfolio service unavailable');
      if (!response.ok) throw new BadGatewayException('Portfolio service request failed');
      if (method === 'DELETE') {
        if (response.status !== 204) throw new BadGatewayException('Portfolio service returned an invalid response');
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
