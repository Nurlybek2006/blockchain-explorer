import {
  JsonRpcError,
  RpcHttpError,
  RpcTimeoutError,
} from './errors.js';

import type {
  BlockTag,
  EthereumRpcClientOptions,
  Hex,
  JsonRpcRequest,
  JsonRpcResponse,
  RpcBlock,
  RpcCallRequest,
  RpcLog,
  RpcLogFilter,
  RpcTransaction,
  RpcTransactionReceipt,
} from './types.js';

import {
  blockTagToRpc,
  hexToBigInt,
  sleep,
} from './utils.js';

export class EthereumRpcClient {
  private readonly url: string;

  private readonly timeoutMs: number;

  private readonly maxRetries: number;

  private readonly retryBaseDelayMs: number;

  private readonly userAgent: string;

  private requestId = 1;

  constructor(
    options: EthereumRpcClientOptions,
  ) {
    if (!options.url) {
      throw new Error(
        'Ethereum RPC URL is required',
      );
    }

    try {
      new URL(options.url);
    } catch {
      throw new Error(
        'Ethereum RPC URL is invalid',
      );
    }

    this.url = options.url;

    this.timeoutMs =
      options.timeoutMs ?? 15_000;

    this.maxRetries =
      options.maxRetries ?? 3;

    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? 500;

    this.userAgent =
      options.userAgent ??
      'blockchain-explorer/1.0';
  }

  async request<T>(
    method: string,
    params: unknown[] = [],
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= this.maxRetries;
      attempt += 1
    ) {
      try {
        return await this.executeRequest<T>(
          method,
          params,
        );
      } catch (error) {
        lastError = error;

        const isLastAttempt =
          attempt >=
          this.maxRetries;

        if (
          isLastAttempt ||
          !this.isRetryable(error)
        ) {
          throw error;
        }

        const delay =
          this.retryBaseDelayMs *
          2 ** attempt;

        await sleep(delay);
      }
    }

    throw lastError;
  }

  private async executeRequest<T>(
    method: string,
    params: unknown[],
  ): Promise<T> {
    const id =
      this.requestId++;

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => {
        controller.abort();
      },
      this.timeoutMs,
    );

    try {
      const response =
        await fetch(
          this.url,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json',

              'user-agent':
                this.userAgent,
            },

            body:
              JSON.stringify(body),

            signal:
              controller.signal,
          },
        );

      if (!response.ok) {
        const responseBody =
          await response.text();

        throw new RpcHttpError(
          response.status,
          responseBody,
        );
      }

      const payload =
        (await response.json()) as JsonRpcResponse<T>;

      if (payload.error) {
        throw new JsonRpcError(
          payload.error.code,
          payload.error.message,
          payload.error.data,
        );
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          payload,
          'result',
        )
      ) {
        throw new Error(
          `Ethereum RPC "${method}" returned no result`,
        );
      }

      return payload.result as T;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        throw new RpcTimeoutError(
          this.timeoutMs,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isRetryable(
    error: unknown,
  ): boolean {
    if (
      error instanceof
      RpcTimeoutError
    ) {
      return true;
    }

    if (
      error instanceof
      RpcHttpError
    ) {
      return (
        error.status === 429 ||
        error.status >= 500
      );
    }

    if (
      error instanceof
      JsonRpcError
    ) {
      const message =
        error.message.toLowerCase();

      return (
        error.code === -32005 ||
        message.includes(
          'rate limit',
        ) ||
        message.includes(
          'timeout',
        ) ||
        message.includes(
          'temporarily',
        )
      );
    }

    if (
      error instanceof TypeError
    ) {
      return true;
    }

    return false;
  }

  async getChainId():
    Promise<number> {
    const result =
      await this.request<Hex>(
        'eth_chainId',
      );

    return Number(
      hexToBigInt(result),
    );
  }

  async getBlockNumber():
    Promise<bigint> {
    const result =
      await this.request<Hex>(
        'eth_blockNumber',
      );

    return hexToBigInt(
      result,
    );
  }

  async getBlockByNumber(
    block: BlockTag,
    fullTransactions: true,
  ): Promise<
    RpcBlock<RpcTransaction> | null
  >;

  async getBlockByNumber(
    block: BlockTag,
    fullTransactions?: false,
  ): Promise<
    RpcBlock<Hex> | null
  >;

  async getBlockByNumber(
    block: BlockTag,
    fullTransactions = false,
  ): Promise<
    | RpcBlock<RpcTransaction>
    | RpcBlock<Hex>
    | null
  > {
    return this.request(
      'eth_getBlockByNumber',
      [
        blockTagToRpc(block),
        fullTransactions,
      ],
    );
  }

  async getBlockByHash(
    hash: Hex | string,
    fullTransactions = false,
  ): Promise<
    | RpcBlock<RpcTransaction>
    | RpcBlock<Hex>
    | null
  > {
    return this.request(
      'eth_getBlockByHash',
      [
        hash,
        fullTransactions,
      ],
    );
  }

  async getTransactionByHash(
    hash: Hex | string,
  ): Promise<
    RpcTransaction | null
  > {
    return this.request(
      'eth_getTransactionByHash',
      [hash],
    );
  }

  async getTransactionReceipt(
    hash: Hex | string,
  ): Promise<
    RpcTransactionReceipt | null
  > {
    return this.request(
      'eth_getTransactionReceipt',
      [hash],
    );
  }

  async getTransactionReceipts(
    hashes: readonly string[],
    concurrency = 8,
  ): Promise<
    Array<
      RpcTransactionReceipt | null
    >
  > {
    if (
      hashes.length === 0
    ) {
      return [];
    }

    const result:
      Array<
        RpcTransactionReceipt | null
      > =
      new Array(
        hashes.length,
      );

    let cursor = 0;

    const worker =
      async (): Promise<void> => {
        while (true) {
          const index =
            cursor++;

          if (
            index >=
            hashes.length
          ) {
            return;
          }

          result[index] =
            await this
              .getTransactionReceipt(
                hashes[index],
              );
        }
      };

    const workers =
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              hashes.length,
            ),
        },
        () => worker(),
      );

    await Promise.all(
      workers,
    );

    return result;
  }

  async getLogs(
    filter: RpcLogFilter,
  ): Promise<RpcLog[]> {
    const rpcFilter = {
      ...filter,

      fromBlock:
        filter.fromBlock !==
        undefined
          ? blockTagToRpc(
              filter.fromBlock,
            )
          : undefined,

      toBlock:
        filter.toBlock !==
        undefined
          ? blockTagToRpc(
              filter.toBlock,
            )
          : undefined,
    };

    return this.request(
      'eth_getLogs',
      [rpcFilter],
    );
  }

  async getBalance(
    address: string,
    block: BlockTag = 'latest',
  ): Promise<bigint> {
    const result =
      await this.request<Hex>(
        'eth_getBalance',
        [
          address,
          blockTagToRpc(block),
        ],
      );

    return hexToBigInt(
      result,
    );
  }

  async getCode(
    address: string,
    block: BlockTag = 'latest',
  ): Promise<Hex> {
    return this.request(
      'eth_getCode',
      [
        address,
        blockTagToRpc(block),
      ],
    );
  }

  async call(
    call:
      RpcCallRequest,
    block: BlockTag = 'latest',
  ): Promise<Hex> {
    return this.request(
      'eth_call',
      [
        call,
        blockTagToRpc(block),
      ],
    );
  }

  async traceTransaction<T = unknown>(
    hash: Hex | string,
    tracerOptions:
      Record<string, unknown> = {},
  ): Promise<T> {
    return this.request(
      'debug_traceTransaction',
      [
        hash,
        tracerOptions,
      ],
    );
  }
}
// Ethereum node-қа тікелей JSON-RPC request жібереді. Timeout, retry, block, transaction, receipt, logs, balance және tracing қолдайды.
// Ең маңыздысы — мұнда ethers.js немесе viem жоқ.