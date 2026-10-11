import {
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  EthereumRpcClient,
  chunkArray,
  hexToBigInt,
  hexToNumber,
  normalizeAddress,
} from '@blockchain-explorer/blockchain-client';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  blocks,
  checkpoints,
  logs as logsTable,
  receipts as receiptsTable,
  syncState,
  transactions as transactionsTable,
} from '../../database/schema/index.js';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

import type {
  RpcBlock,
  RpcTransaction,
  RpcTransactionReceipt,
} from '@blockchain-explorer/blockchain-client';

@Injectable()
export class BlockProcessorService {
  private readonly logger =
    new Logger(
      BlockProcessorService.name,
    );

  constructor(
    private readonly database:
      DatabaseService,

    private readonly rpc:
      EthereumRpcClient,

    private readonly config:
      IndexerConfigService,
  ) {}

  async process(
    chainId: number,
    networkName: string,
    block:
      RpcBlock<RpcTransaction>,
    confirmedHead: bigint,
  ): Promise<void> {
    if (
      block.number === null ||
      block.hash === null
    ) {
      throw new Error(
        'Cannot index pending block without number/hash',
      );
    }

    const blockNumber =
      hexToBigInt(
        block.number,
      );

    const blockHash =
      block.hash.toLowerCase();

    const transactionHashes =
      block.transactions.map(
        (transaction) =>
          transaction.hash,
      );

    /*
     * RPC network request-терді
     * DB transaction басталмай тұрып аламыз.
     */
    const rpcReceipts =
      await this.rpc
        .getTransactionReceipts(
          transactionHashes,
          this.config
            .receiptConcurrency,
        );

    const receipts:
      RpcTransactionReceipt[] =
      rpcReceipts.map(
        (
          receipt,
          index,
        ) => {
          if (!receipt) {
            throw new Error(
              `Receipt not found for transaction ${transactionHashes[index]}`,
            );
          }

          return receipt;
        },
      );

    const blockRow = {
      number:
        blockNumber,

      hash:
        blockHash,

      parentHash:
        block.parentHash
          .toLowerCase(),

      miner:
        normalizeAddress(
          block.miner,
        ),

      timestamp:
        new Date(
          Number(
            hexToBigInt(
              block.timestamp,
            ),
          ) * 1000,
        ),

      gasLimit:
        hexToBigInt(
          block.gasLimit,
        ).toString(),

      gasUsed:
        hexToBigInt(
          block.gasUsed,
        ).toString(),

      baseFeePerGas:
        block.baseFeePerGas
          ? hexToBigInt(
              block.baseFeePerGas,
            ).toString()
          : null,

      size:
        block.size
          ? hexToNumber(
              block.size,
            )
          : null,

      transactionCount:
        block.transactions
          .length,

      transactionsRoot:
        block.transactionsRoot ??
        null,

      stateRoot:
        block.stateRoot ??
        null,

      receiptsRoot:
        block.receiptsRoot ??
        null,

      extraData:
        block.extraData ??
        null,

      indexedAt:
        new Date(),
    };

    const transactionRows =
      block.transactions.map(
        (transaction) => ({
          hash:
            transaction.hash
              .toLowerCase(),

          blockNumber,

          blockHash,

          transactionIndex:
            hexToNumber(
              transaction
                .transactionIndex,
            ),

          fromAddress:
            normalizeAddress(
              transaction.from,
            )!,

          toAddress:
            normalizeAddress(
              transaction.to,
            ),

          nonce:
            hexToBigInt(
              transaction.nonce,
            ).toString(),

          value:
            hexToBigInt(
              transaction.value,
            ).toString(),

          gas:
            hexToBigInt(
              transaction.gas,
            ).toString(),

          gasPrice:
            transaction.gasPrice
              ? hexToBigInt(
                  transaction.gasPrice,
                ).toString()
              : null,

          maxFeePerGas:
            transaction
              .maxFeePerGas
              ? hexToBigInt(
                  transaction
                    .maxFeePerGas,
                ).toString()
              : null,

          maxPriorityFeePerGas:
            transaction
              .maxPriorityFeePerGas
              ? hexToBigInt(
                  transaction
                    .maxPriorityFeePerGas,
                ).toString()
              : null,

          type:
            transaction.type
              ? hexToNumber(
                  transaction.type,
                )
              : 0,

          input:
            transaction.input ??
            '0x',

          indexedAt:
            new Date(),
        }),
      );

    const receiptRows =
      receipts.map(
        (receipt) => ({
          transactionHash:
            receipt.transactionHash
              .toLowerCase(),

          blockNumber:
            hexToBigInt(
              receipt.blockNumber,
            ),

          status:
            receipt.status !==
            '0x0',

          contractAddress:
            normalizeAddress(
              receipt
                .contractAddress,
            ),

          cumulativeGasUsed:
            hexToBigInt(
              receipt
                .cumulativeGasUsed,
            ).toString(),

          gasUsed:
            hexToBigInt(
              receipt.gasUsed,
            ).toString(),

          effectiveGasPrice:
            receipt
              .effectiveGasPrice
              ? hexToBigInt(
                  receipt
                    .effectiveGasPrice,
                ).toString()
              : null,

          logsBloom:
            receipt.logsBloom,
        }),
      );

    const logRows =
      receipts.flatMap(
        (receipt) =>
          receipt.logs.map(
            (log) => {
              if (
                log.transactionHash ===
                  null ||
                log.blockNumber ===
                  null ||
                log.logIndex ===
                  null
              ) {
                throw new Error(
                  'Confirmed transaction log is missing required fields',
                );
              }

              return {
                transactionHash:
                  log
                    .transactionHash
                    .toLowerCase(),

                blockNumber:
                  hexToBigInt(
                    log.blockNumber,
                  ),

                logIndex:
                  hexToNumber(
                    log.logIndex,
                  ),

                address:
                  normalizeAddress(
                    log.address,
                  )!,

                topic0:
                  log.topics[0] ??
                  null,

                topic1:
                  log.topics[1] ??
                  null,

                topic2:
                  log.topics[2] ??
                  null,

                topic3:
                  log.topics[3] ??
                  null,

                data:
                  log.data,

                removed:
                  log.removed,
              };
            },
          ),
      );

    await this.database.db.transaction(
      async (tx) => {
        await tx
          .insert(blocks)
          .values(blockRow)
          .onConflictDoUpdate({
            target:
              blocks.number,

            set: {
              hash:
                blockRow.hash,

              parentHash:
                blockRow.parentHash,

              miner:
                blockRow.miner,

              timestamp:
                blockRow.timestamp,

              gasLimit:
                blockRow.gasLimit,

              gasUsed:
                blockRow.gasUsed,

              baseFeePerGas:
                blockRow
                  .baseFeePerGas,

              size:
                blockRow.size,

              transactionCount:
                blockRow
                  .transactionCount,

              transactionsRoot:
                blockRow
                  .transactionsRoot,

              stateRoot:
                blockRow
                  .stateRoot,

              receiptsRoot:
                blockRow
                  .receiptsRoot,

              extraData:
                blockRow.extraData,

              indexedAt:
                new Date(),
            },
          });

        for (
          const chunk of
          chunkArray(
            transactionRows,
            250,
          )
        ) {
          if (
            chunk.length > 0
          ) {
            await tx
              .insert(
                transactionsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }
        }

        for (
          const chunk of
          chunkArray(
            receiptRows,
            250,
          )
        ) {
          if (
            chunk.length > 0
          ) {
            await tx
              .insert(
                receiptsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }
        }

        for (
          const chunk of
          chunkArray(
            logRows,
            250,
          )
        ) {
          if (
            chunk.length > 0
          ) {
            await tx
              .insert(
                logsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }
        }

        await tx
          .insert(syncState)
          .values({
            chainId,

            networkName,

            lastScannedBlock:
              blockNumber
                .toString(),

            lastFinalizedBlock:
              confirmedHead
                .toString(),

            lastBlockHash:
              blockHash,

            status:
              'running',

            updatedAt:
              new Date(),
          })
          .onConflictDoUpdate({
            target:
              syncState.chainId,

            set: {
              networkName,

              lastScannedBlock:
                blockNumber
                  .toString(),

              lastFinalizedBlock:
                confirmedHead
                  .toString(),

              lastBlockHash:
                blockHash,

              status:
                'running',

              updatedAt:
                new Date(),
            },
          });

        if (
          blockNumber %
            BigInt(
              this.config
                .checkpointInterval,
            ) ===
          0n
        ) {
          await tx
            .insert(
              checkpoints,
            )
            .values({
              chainId,

              blockNumber,

              blockHash,

              createdAt:
                new Date(),
            })
            .onConflictDoUpdate({
              target: [
                checkpoints
                  .chainId,

                checkpoints
                  .blockNumber,
              ],

              set: {
                blockHash,

                createdAt:
                  new Date(),
              },
            });
        }
      },
    );

    this.logger.log(
      `Indexed block ${blockNumber} (${block.transactions.length} tx, ${logRows.length} logs)`,
    );
  }
}
// Block, transaction, receipt және smart-contract log-тарды бір PostgreSQL transaction ішінде сақтайды. Бір бөлігі қате болса, block толық rollback болады.
// Бұл — indexer-дің негізгі ядросы.