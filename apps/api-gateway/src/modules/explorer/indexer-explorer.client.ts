import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';
import { decodeBlockDetail, decodeContract, decodeNetworkStatus, decodeSearch, decodeTraces } from './advanced-explorer.decoder.js';
import { propagationHeaders } from '@blockchain-explorer/observability';
import { decodeWalletActivity } from '@blockchain-explorer/contracts';

@Injectable()
export class IndexerExplorerClient {
  private readonly baseUrl:
    string;

  private readonly token:
    string;

  constructor(
    private readonly config:
      ConfigService,
  ) {
    this.baseUrl =
      this.config
        .getOrThrow<string>(
          'INDEXER_INTERNAL_URL',
        )
        .replace(
          /\/+$/,
          '',
        );

    this.token =
      this.config
        .getOrThrow<string>(
          'INTERNAL_SERVICE_TOKEN',
        );
  }

  getStats() {
    return this.get(
      '/internal/explorer/stats',
    );
  }

  getBlocks(
    page: number,
    limit: number,
  ) {
    return this.get(
      '/internal/explorer/blocks',
      {
        page,
        limit,
      },
    );
  }

  getBlock(
    blockNumber: string,
  ) {
    return this.get(
      `/internal/explorer/blocks/${encodeURIComponent(blockNumber)}`,
    );
  }

  getTransaction(
    hash: string,
  ) {
    return this.get(
      `/internal/explorer/transactions/${encodeURIComponent(hash)}`,
    );
  }

  getAddress(
    address: string,
    page: number,
    limit: number,
  ) {
    return this.get(
      `/internal/explorer/addresses/${encodeURIComponent(address)}`,
      {
        page,
        limit,
      },
    );
  }

  getTokens(
    page: number,
    limit: number,
  ) {
    return this.get(
      '/internal/explorer/tokens',
      {
        page,
        limit,
      },
    );
  }

  getToken(
    address: string,
    page: number,
    limit: number,
  ) {
    return this.get(
      `/internal/explorer/tokens/${encodeURIComponent(address)}`,
      {
        page,
        limit,
      },
    );
  }

  async getContract(address: string) {
    const response = decodeContract(await this.get(`/internal/explorer/contracts/${encodeURIComponent(address)}`));
    if (response.address !== address.toLowerCase()) throw new BadGatewayException('Indexer service returned an invalid response');
    return response;
  }
  async getTraces(hash: string) {
    const response = decodeTraces(await this.get(`/internal/explorer/transactions/${encodeURIComponent(hash)}/traces`));
    if (response.transactionHash !== hash.toLowerCase()) throw new BadGatewayException('Indexer service returned an invalid response');
    return response;
  }
  async getBlockByHash(hash: string) {
    const response = decodeBlockDetail(await this.get(`/internal/explorer/blocks/hash/${encodeURIComponent(hash)}`));
    if (response.hash !== hash.toLowerCase()) throw new BadGatewayException('Indexer service returned an invalid response');
    return response;
  }
  async search(q: string) { return decodeSearch(await this.get('/internal/explorer/search', { q })); }
  async getNetworkStatus() { return decodeNetworkStatus(await this.get('/internal/explorer/network/status')); }

  private async get(
    path: string,

    query?: Record<
      string,
      string | number
    >,
  ): Promise<unknown> {
    const url =
      new URL(
        `${this.baseUrl}${path}`,
      );

    if (query) {
      for (
        const [
          key,
          value,
        ] of
        Object.entries(
          query,
        )
      ) {
        url.searchParams.set(
          key,
          String(value),
        );
      }
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => {
          controller.abort();
        },
        10_000,
      );

    try {
      const response =
        await fetch(
          url,
          {
            method:
              'GET',

            headers: {
              ...propagationHeaders(),
              'x-internal-service-token':
                this.token,

              accept:
                'application/json',
            },

            signal:
              controller.signal,

            redirect: 'error',
          },
        );

      const body =
        await this.readBody(
          response,
        );

      if (
        response.ok
      ) {
        return body;
      }

      if (
        response.status ===
        400
      ) {
        throw new BadRequestException(
          'Invalid Explorer request',
        );
      }

      if (
        response.status ===
        404
      ) {
        throw new NotFoundException(
          'Explorer resource not found',
        );
      }

      throw new BadGatewayException('Indexer service request failed');
    } catch (error) {
      if (
        error instanceof
        BadRequestException ||
        error instanceof
        NotFoundException ||
        error instanceof
        BadGatewayException
      ) {
        throw error;
      }

      throw new BadGatewayException('Indexer service unavailable');
    } finally {
      clearTimeout(
        timeout,
      );
    }
  }

  private async readBody(
    response: Response,
  ): Promise<unknown> {
    const maxBytes = 16 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new BadGatewayException('Indexer service response exceeds the supported size');
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new BadGatewayException('Indexer service response exceeds the supported size');
        }
        parts.push(decoder.decode(chunk.value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally { reader.releaseLock(); }
    const text = parts.join('');

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(
        text,
      );
    } catch {
      return text;
    }
  }

  async getActivity(
    address: string,
    page: number,
    limit: number,
  ) {
    const body = await this.get(
      `/internal/explorer/addresses/${encodeURIComponent(address)}/activity`,
      { page, limit },
    );

    try {
      const result = decodeWalletActivity(body);

      if (
        result.address !== address.toLowerCase() ||
        result.pagination.page !== page ||
        result.pagination.limit !== limit
      ) {
        throw new Error('Activity response mismatch');
      }

      return result;
    } catch {
      throw new BadGatewayException(
        'Indexer service returned an invalid activity response',
      );
    }
  }
}
// API Gateway-ден Indexer internal API-ға HTTP request жібереді және microservice error-ларын дұрыс өңдейді.
