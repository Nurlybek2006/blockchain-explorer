import {
  Module,
} from '@nestjs/common';

import {
  ConfigService,
} from '@nestjs/config';

import {
  Erc20Client,
  EthereumRpcClient,
} from '@blockchain-explorer/blockchain-client';

@Module({
  providers: [
    {
      provide:
        EthereumRpcClient,

      inject: [
        ConfigService,
      ],

      useFactory: (
        config:
          ConfigService,
      ) =>
        new EthereumRpcClient({
          url:
            config
              .getOrThrow<string>(
                'ETHEREUM_RPC_URL',
              ),

          timeoutMs:
            Number(
              config.get(
                'RPC_TIMEOUT_MS',
              ) ??
                15_000,
            ),

          maxRetries:
            Number(
              config.get(
                'RPC_MAX_RETRIES',
              ) ??
                6,
            ),

          maxRetryDelayMs:
            Number(
              config.get(
                'RPC_MAX_RETRY_DELAY_MS',
              ) ??
                30_000,
            ),

          maxConcurrentRequests:
            2,

          requestsPerSecond:
            3,

          userAgent:
            'blockchain-explorer-portfolio/1.0',
        }),
    },

    {
      provide:
        Erc20Client,

      inject: [
        EthereumRpcClient,
      ],

      useFactory: (
        rpc:
          EthereumRpcClient,
      ) =>
        new Erc20Client(
          rpc,
        ),
    },
  ],

  exports: [
    EthereumRpcClient,

    Erc20Client,
  ],
})
export class RpcModule {}