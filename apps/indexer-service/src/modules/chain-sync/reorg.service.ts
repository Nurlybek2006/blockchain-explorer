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
  addresses,
  contractVerifications,
  checkpoints,
  outboxEvents,
  syncState,
} from '../../database/schema/index.js';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

import {
  createEventEnvelope,
  EVENT_TYPES,
} from '@blockchain-explorer/contracts';
import { injectTraceContext, recordCounter, withSpan } from '@blockchain-explorer/observability';

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

    return withSpan('indexer.reorg', { 'ethereum.chain_id': chainId, 'ethereum.block_number': blockNumber.toString() },
      () => this.rewind(chainId, blockNumber, previousNumber));
  }

  private async rewind(chainId: number, blockNumber: bigint, previousNumber: bigint): Promise<boolean> {
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

    const ancestor = commonAncestor;

    const reorgEvent =
      createEventEnvelope(
        EVENT_TYPES
          .CHAIN_REORGANIZED,

        'indexer-service',

        {
          chainId,

          networkName:
            getNetworkName(
              chainId,
            ),

          detectedAtBlock:
            blockNumber
              .toString(),

          commonAncestorBlock:
            commonAncestor
              .toString(),

          commonAncestorHash,
        },
      );

    await this.database.db.transaction(
      async (tx) => {
        // Discovery belongs to the canonical branch. A worker result is also guarded by discovery block hash.
        await tx.delete(contractVerifications).where(gt(contractVerifications.discoveredBlock, ancestor));
        await tx.delete(addresses).where(gt(addresses.firstSeenBlock, ancestor));
        await tx.update(addresses).set({ isContract: false, codeCheckedBlock: null, codeCheckAfter: new Date(), codeCheckAttempts: 0 })
          .where(gt(addresses.codeCheckedBlock, ancestor));
        await tx.update(addresses).set({ lastSeenBlock: ancestor, updatedAt: new Date() }).where(gt(addresses.lastSeenBlock, ancestor));
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
              ancestor,
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
              ancestor,
            ),
          );

        await tx
          .update(syncState)
          .set({
            lastScannedBlock:
              ancestor
                .toString(),

            lastFinalizedBlock:
              ancestor
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

        await tx
          .insert(
            outboxEvents,
          )
          .values({
            id:
              reorgEvent.id,

            eventType:
              reorgEvent.type,

            aggregateType:
              'chain',

            aggregateId:
              String(chainId),

            payload: {
              ...reorgEvent,
              metadata: { traceContext: injectTraceContext() },
            },

            status:
              'pending',

            attempts:
              0,

            availableAt:
              new Date(),

            createdAt:
              new Date(),
          });
      },
    );

    recordCounter('indexer_reorgs_total');

    this.logger.warn(
      `Indexer rewound to common ancestor ${commonAncestor}`,
    );

    return true;
  }
}

function getNetworkName(
  chainId: number,
): string {
  if (
    chainId === 1
  ) {
    return 'ethereum-mainnet';
  }

  if (
    chainId ===
    11155111
  ) {
    return 'ethereum-sepolia';
  }

  return `ethereum-${chainId}`;
}
// Blockchain chain өзгерсе, common ancestor тауып, қате branch-тағы block-тарды өшіріп Indexer-ді артқа қайтарады.
// Blockchain reorg болса Portfolio Service-ке rebuild event жібереді.
