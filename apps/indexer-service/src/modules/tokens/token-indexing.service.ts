import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  inArray,
} from 'drizzle-orm';

import {
  Erc20Client,
  hexToBigInt,
  hexToNumber,
  normalizeAddress,
  type RpcTransactionReceipt,
} from '@blockchain-explorer/blockchain-client';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  tokens,
  tokenTransfers,
} from '../../database/schema/index.js';

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export type PreparedToken =
  typeof tokens.$inferInsert;

export type PreparedTokenTransfer =
  typeof tokenTransfers.$inferInsert;

export interface TokenIndexingResult {
  tokens: PreparedToken[];

  transfers: PreparedTokenTransfer[];
}

@Injectable()
export class TokenIndexingService {
  private readonly logger =
    new Logger(
      TokenIndexingService.name,
    );

  constructor(
    private readonly database:
      DatabaseService,

    private readonly erc20:
      Erc20Client,
  ) {}

  async prepare(
    receipts:
      RpcTransactionReceipt[],

    blockNumber: bigint,
  ): Promise<TokenIndexingResult> {
    const transfers =
      this.extractTransfers(
        receipts,
        blockNumber,
      );

    if (
      transfers.length ===
      0
    ) {
      return {
        tokens: [],
        transfers: [],
      };
    }

    const tokenAddresses = [
      ...new Set(
        transfers.map(
          (transfer) =>
            transfer.tokenAddress,
        ),
      ),
    ];

    const existingTokens =
      tokenAddresses.length >
      0
        ? await this.database.db
            .select()
            .from(tokens)
            .where(
              inArray(
                tokens.address,
                tokenAddresses,
              ),
            )
        : [];

    const existingMap =
      new Map(
        existingTokens.map(
          (token) => [
            token.address,
            token,
          ],
        ),
      );

    const tokenRows:
      PreparedToken[] = [];

    for (
      const address of
      tokenAddresses
    ) {
      const existing =
        existingMap.get(
          address,
        );

      const token =
        await this.prepareToken(
          address,
          blockNumber,
          existing,
        );

      tokenRows.push(
        token,
      );
    }

    return {
      tokens:
        tokenRows,

      transfers,
    };
  }

  private extractTransfers(
    receipts:
      RpcTransactionReceipt[],

    blockNumber: bigint,
  ): PreparedTokenTransfer[] {
    const result:
      PreparedTokenTransfer[] =
      [];

    for (
      const receipt of receipts
    ) {
      for (
        const log of
        receipt.logs
      ) {
        if (
          !this.isErc20Transfer(
            log.topics,
            log.data,
          )
        ) {
          continue;
        }

        if (
          log.logIndex ===
            null ||
          !log.transactionHash
        ) {
          continue;
        }

        const fromAddress =
          this.topicToAddress(
            log.topics[1],
          );

        const toAddress =
          this.topicToAddress(
            log.topics[2],
          );

        if (
          !fromAddress ||
          !toAddress
        ) {
          continue;
        }

        let amount:
          bigint;

        try {
          amount =
            hexToBigInt(
              log.data,
            );
        } catch {
          continue;
        }

        result.push({
          transactionHash:
            log.transactionHash
              .toLowerCase(),

          blockNumber,

          tokenAddress:
            normalizeAddress(
              log.address,
            )!,

          fromAddress,

          toAddress,

          amount:
            amount.toString(),

          transactionIndex:
            hexToNumber(
              receipt
                .transactionIndex,
            ),

          logIndex:
            hexToNumber(
              log.logIndex,
            ),

          removed:
            log.removed,

          indexedAt:
            new Date(),
        });
      }
    }

    return result;
  }

  private isErc20Transfer(
    topics:
      readonly string[],

    data: string,
  ): boolean {
    /*
     * ERC-20 Transfer:
     *
     * topic0 = Transfer signature
     * topic1 = from
     * topic2 = to
     * data   = amount
     *
     * ERC-721 Transfer-де көбіне
     * 4 topic болады.
     */
    return (
      topics.length === 3 &&
      topics[0]?.toLowerCase() ===
        ERC20_TRANSFER_TOPIC &&
      data.startsWith(
        '0x',
      ) &&
      data.length >= 66
    );
  }

  private topicToAddress(
    topic:
      string | undefined,
  ): string | null {
    if (
      !topic ||
      topic.length <
        42
    ) {
      return null;
    }

    return `0x${topic
      .slice(-40)
      .toLowerCase()}`;
  }

  private async prepareToken(
    address: string,
    blockNumber: bigint,
    existing?: {
      name:
        string | null;

      symbol:
        string | null;

      decimals:
        number | null;

      totalSupply:
        string | null;

      firstSeenBlock:
        bigint | null;

      createdAt:
        Date;
    },
  ): Promise<PreparedToken> {
    let name =
      existing?.name ??
      null;

    let symbol =
      existing?.symbol ??
      null;

    let decimals =
      existing?.decimals ??
      null;

    let totalSupply =
      existing?.totalSupply ??
      null;

    const needsMetadata =
      !existing ||
      symbol === null ||
      decimals === null;

    if (
      needsMetadata
    ) {
      const [
        nameResult,
        symbolResult,
        decimalsResult,
        supplyResult,
      ] =
        await Promise.allSettled(
          [
            this.erc20.name(
              address,
              blockNumber,
            ),

            this.erc20.symbol(
              address,
              blockNumber,
            ),

            this.erc20.decimals(
              address,
              blockNumber,
            ),

            this.erc20.totalSupply(
              address,
              blockNumber,
            ),
          ],
        );

      if (
        nameResult.status ===
        'fulfilled'
      ) {
        name =
          nameResult.value;
      }

      if (
        symbolResult.status ===
        'fulfilled'
      ) {
        symbol =
          symbolResult.value;
      }

      if (
        decimalsResult.status ===
        'fulfilled'
      ) {
        decimals =
          decimalsResult.value;
      }

      if (
        supplyResult.status ===
        'fulfilled'
      ) {
        totalSupply =
          supplyResult.value
            .toString();
      }

      this.logger.log(
        `Token discovered ${address} ${symbol ?? ''}`,
      );
    }

    return {
      address,

      name,

      symbol,

      decimals,

      totalSupply,

      firstSeenBlock:
        existing
          ?.firstSeenBlock ??
        blockNumber,

      lastUpdatedBlock:
        blockNumber,

      createdAt:
        existing
          ?.createdAt ??
        new Date(),

      updatedAt:
        new Date(),
    };
  }
}