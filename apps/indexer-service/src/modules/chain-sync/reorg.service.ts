import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  eq,
  gt,
} from 'drizzle-orm';

import {
  EthereumRpcClient,
  hexToBigInt,
} from '@blockchain-explorer/blockchain-client';

import type {
  RpcBlock,
  RpcTransaction,
} from '@blockchain-explorer/blockchain-client';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  blocks,
  checkpoints,
  syncState,
} from '../../database/schema/index.js';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

@Injectable()
export class ReorgService {
  private readonly logger =
    new Logger(
      ReorgService.name,
    );

  constructor(
    private readonly database:
      DatabaseService,

    private readonly rpc:
      EthereumRpcClient,

    private readonly config:
      IndexerConfigService,
  ) { }

  async ensureCanonicalParent(
    chainId: number,
    incomingBlock:
      RpcBlock<RpcTransaction>,
  ): Promise<boolean> {
    if (
      incomingBlock.number ===
      null ||
      incomingBlock.hash ===
      null
    ) {
      return false;
    }

    const blockNumber =
      hexToBigInt(
        incomingBlock.number,
      );

    if (
      blockNumber === 0n
    ) {
      return false;
    }

    const previousNumber =
      blockNumber - 1n;

    const [localPrevious] =
      await this.database.db
        .select({
          number:
            blocks.number,

          hash:
            blocks.hash,
        })
        .from(blocks)
        .where(
          eq(
            blocks.number,
            previousNumber,
          ),
        )
        .limit(1);

    /*
     * Бұл project indexing-ті
     * latest block-тан бастаса,
     * previous block локалда болмауы мүмкін.
     */
    if (!localPrevious) {
      return false;
    }

    if (
      localPrevious.hash
        .toLowerCase() ===
      incomingBlock.parentHash
        .toLowerCase()
    ) {
      return false;
    }

    this.logger.warn(
      `Blockchain reorg detected near block ${blockNumber}`,
    );

    let commonAncestor:
      bigint | null = null;

    let commonAncestorHash:
      string | null = null;

    const minimumHeight =
      blockNumber >
        BigInt(
          this.config
            .reorgMaxDepth,
        )
        ? blockNumber -
        BigInt(
          this.config
            .reorgMaxDepth,
        )
        : 0n;

    for (
      let height =
        previousNumber;
      height >=
      minimumHeight;
      height -= 1n
    ) {
      const [localBlock] =
        await this.database.db
          .select({
            hash:
              blocks.hash,
          })
          .from(blocks)
          .where(
            eq(
              blocks.number,
              height,
            ),
          )
          .limit(1);

      if (localBlock) {
        const remoteBlock =
          await this.rpc
            .getBlockByNumber(
              height,
              false,
            );

        if (
          remoteBlock?.hash &&
          remoteBlock.hash
            .toLowerCase() ===
          localBlock.hash
            .toLowerCase()
        ) {
          commonAncestor =
            height;

          commonAncestorHash =
            remoteBlock.hash
              .toLowerCase();

          break;
        }
      }

      if (
        height === 0n
      ) {
        break;
      }
    }

    if (
      commonAncestor === null
    ) {
      throw new Error(
        `Could not find common ancestor within ${this.config.reorgMaxDepth} blocks`,
      );
    }

    await this.database.db.transaction(
      async (tx) => {
        /*
         * blocks delete болғанда
         * transactions/receipts/logs
         * FK cascade арқылы жойылады.
         */
        await tx
          .delete(blocks)
          .where(
            gt(
              blocks.number,
              commonAncestor!,
            ),
          );

        await tx
          .delete(
            checkpoints,
          )
          .where(
            gt(
              checkpoints
                .blockNumber,
              commonAncestor!,
            ),
          );

        await tx
          .update(syncState)
          .set({
            lastScannedBlock:
              commonAncestor!
                .toString(),

            lastFinalizedBlock:
              commonAncestor!
                .toString(),

            lastBlockHash:
              commonAncestorHash,

            status:
              'reorg',

            updatedAt:
              new Date(),
          })
          .where(
            eq(
              syncState.chainId,
              chainId,
            ),
          );
      },
    );

    this.logger.warn(
      `Indexer rewound to common ancestor ${commonAncestor}`,
    );

    return true;
  }
}
// Blockchain chain өзгерсе, common ancestor тауып, қате branch-тағы block-тарды өшіріп Indexer-ді артқа қайтарады.