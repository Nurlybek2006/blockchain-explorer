import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

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
              'x-internal-service-token':
                this.token,

              accept:
                'application/json',
            },

            signal:
              controller.signal,
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
          body,
        );
      }

      if (
        response.status ===
        404
      ) {
        throw new NotFoundException(
          body,
        );
      }

      throw new BadGatewayException({
        message:
          'Indexer service request failed',

        status:
          response.status,

        details:
          body,
      });
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

      throw new BadGatewayException({
        message:
          'Indexer service unavailable',

        cause:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      });
    } finally {
      clearTimeout(
        timeout,
      );
    }
  }

  private async readBody(
    response: Response,
  ): Promise<unknown> {
    const text =
      await response.text();

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
}
// API Gateway-ден Indexer internal API-ға HTTP request жібереді және microservice error-ларын дұрыс өңдейді.