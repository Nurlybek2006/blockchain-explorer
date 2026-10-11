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
      ) => {
        const url =
          config.getOrThrow<string>(
            'ETHEREUM_RPC_URL',
          );

        return new EthereumRpcClient(
          {
            url,

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
                  3,
              ),

            retryBaseDelayMs:
              Number(
                config.get(
                  'RPC_RETRY_BASE_DELAY_MS',
                ) ??
                  500,
              ),

            userAgent:
              'blockchain-explorer-indexer/1.0',
          },
        );
      },
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
// EthereumRpcClient пен Erc20Client-ті NestJS dependency injection жүйесіне қосады.