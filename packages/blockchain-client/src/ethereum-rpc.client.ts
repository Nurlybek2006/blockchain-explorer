import {
    JsonRpcError,
    RpcHttpError,
    RpcTimeoutError,
} from './errors.js';

import {
    RpcRateLimiter,
} from './rpc-rate-limiter.js';

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
    private closing = false;
    private readonly controllers = new Set<AbortController>();
    private readonly url: string;

    private readonly timeoutMs:
        number;

    private readonly maxRetries:
        number;

    private readonly retryBaseDelayMs:
        number;

    private readonly maxRetryDelayMs:
        number;

    private readonly userAgent:
        string;

    private readonly rateLimiter:
        RpcRateLimiter;

    private requestId = 1;

    constructor(
        options:
            EthereumRpcClientOptions,
    ) {
        if (!options.url) {
            throw new Error(
                'Ethereum RPC URL is required',
            );
        }

        try {
            new URL(
                options.url,
            );
        } catch {
            throw new Error(
                'Ethereum RPC URL is invalid',
            );
        }

        this.url =
            options.url;

        this.timeoutMs =
            options.timeoutMs ??
            15_000;

        this.maxRetries =
            options.maxRetries ??
            6;

        this.retryBaseDelayMs =
            options.retryBaseDelayMs ??
            500;

        this.maxRetryDelayMs =
            options.maxRetryDelayMs ??
            30_000;

        this.userAgent =
            options.userAgent ??
            'blockchain-explorer/1.0';

        this.rateLimiter =
            new RpcRateLimiter({
                maxConcurrentRequests:
                    options
                        .maxConcurrentRequests ??
                    3,

                requestsPerSecond:
                    options
                        .requestsPerSecond ??
                    5,
            });
    }

    async request<T>(
        method: string,
        params: unknown[] = [],
    ): Promise<T> {
        let lastError:
            unknown;

        for (
            let attempt = 0;
            attempt <=
            this.maxRetries;
            attempt += 1
        ) {
            if (this.closing) throw new Error('Ethereum RPC client is closed');
            try {
                return await this
                    .rateLimiter
                    .schedule(
                        () =>
                            this.executeRequest<T>(
                                method,
                                params,
                            ),
                    );
            } catch (error) {
                lastError =
                    error;

                const isLastAttempt =
                    attempt >=
                    this.maxRetries;

                if (
                    this.closing || isLastAttempt ||
                    !this.isRetryable(
                        error,
                    )
                ) {
                    throw error;
                }

                const retryDelay =
                    this.calculateRetryDelay(
                        error,
                        attempt,
                    );

                /*
                 * 429 кезінде тек осы
                 * request емес, бүкіл RPC
                 * queue-ны уақытша баяулатамыз.
                 */
                if (
                    error instanceof
                    RpcHttpError &&
                    error.status ===
                    429
                ) {
                    this.rateLimiter
                        .coolDown(
                            retryDelay,
                        );
                }

                await sleep(
                    retryDelay,
                );
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

        const body:
            JsonRpcRequest = {
            jsonrpc:
                '2.0',

            id,

            method,

            params,
        };

        const controller =
            new AbortController();
        this.controllers.add(controller);

        const timeout =
            setTimeout(
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
                        method:
                            'POST',

                        headers: {
                            'content-type':
                                'application/json',

                            'user-agent':
                                this.userAgent,
                        },

                        body:
                            JSON.stringify(
                                body,
                            ),

                        signal:
                            controller.signal,
                    },
                );

            if (
                !response.ok
            ) {
                const responseBody =
                    await response.text();

                const retryAfterMs =
                    this.parseRetryAfter(
                        response.headers.get(
                            'retry-after',
                        ),
                    );

                throw new RpcHttpError(
                    response.status,
                    responseBody,
                    retryAfterMs,
                );
            }

            const payload =
                (await response.json()) as
                JsonRpcResponse<T>;

            if (
                payload.error
            ) {
                throw new JsonRpcError(
                    payload.error.code,
                    payload.error.message,
                    payload.error.data,
                );
            }

            if (
                !Object.prototype
                    .hasOwnProperty.call(
                        payload,
                        'result',
                    )
            ) {
                throw new Error(
                    `Ethereum RPC "${method}" returned no result`,
                );
            }

            return payload
                .result as T;
        } catch (error) {
            if (
                error instanceof
                Error &&
                error.name ===
                'AbortError'
            ) {
                throw new RpcTimeoutError(
                    this.timeoutMs,
                );
            }

            throw error;
        } finally {
            this.controllers.delete(controller);
            clearTimeout(
                timeout,
            );
        }
    }

    /** Abort isolated background clients during service shutdown. Existing clients remain open until called. */
    close(): void {
        this.closing = true;
        this.rateLimiter.close();
        for (const controller of this.controllers) controller.abort();
    }

    private calculateRetryDelay(
        error: unknown,
        attempt: number,
    ): number {
        const exponentialDelay =
            Math.min(
                this
                    .retryBaseDelayMs *
                2 ** attempt,

                this
                    .maxRetryDelayMs,
            );

        /*
         * Көп request бір уақытта
         * қайта жіберілмеуі үшін
         * randomized jitter.
         */
        const jitterLimit =
            Math.max(
                100,
                Math.floor(
                    exponentialDelay *
                    0.25,
                ),
            );

        const jitter =
            Math.floor(
                Math.random() *
                jitterLimit,
            );

        const calculatedDelay =
            Math.min(
                exponentialDelay +
                jitter,

                this
                    .maxRetryDelayMs,
            );

        if (
            error instanceof
            RpcHttpError
        ) {
            return Math.max(
                calculatedDelay,

                error.retryAfterMs ??
                0,
            );
        }

        return calculatedDelay;
    }

    private parseRetryAfter(
        header:
            string | null,
    ): number | undefined {
        if (!header) {
            return undefined;
        }

        const seconds =
            Number(header);

        if (
            Number.isFinite(
                seconds,
            ) &&
            seconds >= 0
        ) {
            return (
                seconds * 1000
            );
        }

        const date =
            Date.parse(
                header,
            );

        if (
            Number.isNaN(
                date,
            )
        ) {
            return undefined;
        }

        return Math.max(
            0,
            date -
            Date.now(),
        );
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
                error.status ===
                408 ||
                error.status ===
                425 ||
                error.status ===
                429 ||
                error.status >=
                500
            );
        }

        if (
            error instanceof
            JsonRpcError
        ) {
            const message =
                error.message
                    .toLowerCase();

            return (
                error.code ===
                -32005 ||
                message.includes(
                    'rate limit',
                ) ||
                message.includes(
                    'too many requests',
                ) ||
                message.includes(
                    'timeout',
                ) ||
                message.includes(
                    'temporarily unavailable',
                ) ||
                message.includes(
                    'busy',
                )
            );
        }

        /*
         * fetch network қатесі көбіне
         * TypeError болып келеді.
         */
        if (
            error instanceof
            TypeError
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
            hexToBigInt(
                result,
            ),
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
                blockTagToRpc(
                    block,
                ),

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
            [
                hash,
            ],
        );
    }

    async getTransactionReceipt(
        hash: Hex | string,
    ): Promise<
        RpcTransactionReceipt | null
    > {
        return this.request(
            'eth_getTransactionReceipt',
            [
                hash,
            ],
        );
    }

    async getTransactionReceipts(
        hashes:
            readonly string[],
        concurrency = 8,
    ): Promise<
        Array<
            RpcTransactionReceipt | null
        >
    > {
        if (
            hashes.length ===
            0
        ) {
            return [];
        }

        if (
            concurrency <
            1
        ) {
            throw new Error(
                'Receipt concurrency must be >= 1',
            );
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

        const workerCount =
            Math.min(
                concurrency,
                hashes.length,
            );

        await Promise.all(
            Array.from(
                {
                    length:
                        workerCount,
                },

                () =>
                    worker(),
            ),
        );

        return result;
    }

    async getLogs(
        filter:
            RpcLogFilter,
    ): Promise<RpcLog[]> {
        const rpcFilter = {
            ...filter,

            fromBlock:
                filter.fromBlock !==
                    undefined
                    ? blockTagToRpc(
                        filter
                            .fromBlock,
                    )
                    : undefined,

            toBlock:
                filter.toBlock !==
                    undefined
                    ? blockTagToRpc(
                        filter
                            .toBlock,
                    )
                    : undefined,
        };

        return this.request(
            'eth_getLogs',
            [
                rpcFilter,
            ],
        );
    }

    async getBalance(
        address: string,
        block:
            BlockTag = 'latest',
    ): Promise<bigint> {
        const result =
            await this.request<Hex>(
                'eth_getBalance',
                [
                    address,

                    blockTagToRpc(
                        block,
                    ),
                ],
            );

        return hexToBigInt(
            result,
        );
    }

    async getCode(
        address: string,
        block:
            BlockTag = 'latest',
    ): Promise<Hex> {
        return this.request(
            'eth_getCode',
            [
                address,

                blockTagToRpc(
                    block,
                ),
            ],
        );
    }

    async call(
        call:
            RpcCallRequest,
        block:
            BlockTag = 'latest',
    ): Promise<Hex> {
        return this.request(
            'eth_call',
            [
                call,

                blockTagToRpc(
                    block,
                ),
            ],
        );
    }

    async traceTransaction<
        T = unknown,
    >(
        hash:
            Hex | string,

        tracerOptions:
            Record<
                string,
                unknown
            > = {},
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
// Ethereum RPC request-теріне ортақ rate limiter, retry, exponential backoff, jitter және Retry-After support қосады. 429 енді бүкіл Indexer-ді error loop-қа түсірмей, provider-дің лимитіне бейімделеді.
