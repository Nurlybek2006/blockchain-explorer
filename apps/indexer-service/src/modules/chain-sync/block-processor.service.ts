import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdvancedExplorerRepository } from '../advanced/advanced-explorer.repository.js';
import { loadAdvancedConfig, type AdvancedConfig } from '../advanced/advanced.config.js';

import {
  sql,
} from 'drizzle-orm';

import {
  EthereumRpcClient,
  chunkArray,
  hexToBigInt,
  hexToNumber,
  normalizeAddress,
  type RpcBlock,
  type RpcTransaction,
  type RpcTransactionReceipt,
} from '@blockchain-explorer/blockchain-client';

import {
  DatabaseService,
} from '../../database/database.service.js';

import {
  addresses as addressesTable,
  blocks,
  checkpoints,
  logs as logsTable,
  receipts as receiptsTable,
  syncState,
  tokenTransfers as tokenTransfersTable,
  tokens as tokensTable,
  transactions as transactionsTable,
} from '../../database/schema/index.js';

import {
  IndexerConfigService,
} from '../../config/indexer-config.service.js';

import {
  TokenIndexingService,
} from '../tokens/token-indexing.service.js';

import {
  AddressIndexingService,
} from '../addresses/address-indexing.service.js';

import {
  outboxEvents,
} from '../../database/schema/index.js';

import {
  IndexerEventFactory,
} from '../messaging/indexer-event.factory.js';

@Injectable()
export class BlockProcessorService {
  private readonly advancedOptions: AdvancedConfig;
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

    private readonly tokenIndexer:
      TokenIndexingService,

    private readonly addressIndexer:
      AddressIndexingService,

    private readonly eventFactory:
      IndexerEventFactory,
    private readonly advancedRepository: AdvancedExplorerRepository,
    advancedConfig: ConfigService,
  ) { this.advancedOptions = loadAdvancedConfig(advancedConfig); }

  async process(
    chainId: number,

    networkName: string,

    block:
      RpcBlock<RpcTransaction>,

    confirmedHead: bigint,
  ): Promise<void> {
    if (
      block.number ===
      null ||
      block.hash ===
      null
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
      block.hash
        .toLowerCase();

    const transactionHashes =
      block.transactions.map(
        (transaction) =>
          transaction.hash,
      );

    /*
     * Network request-терді
     * PostgreSQL transaction
     * ашпай тұрып орындаймыз.
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

    /*
     * ERC-20 event parsing +
     * token metadata discovery.
     */
    const tokenData =
      await this.tokenIndexer
        .prepare(
          receipts,
          blockNumber,
        );

    /*
     * Block ішінде кездескен
     * address-тер.
     */
    const addressRows =
      this.addressIndexer
        .prepare(
          block,
          receipts,
          tokenData.transfers,
          blockNumber,
        );
    for (const row of addressRows) if (row.isContract) row.codeCheckedBlock = blockNumber;
    const contractCandidates = [...new Set([
      ...block.transactions.flatMap((transaction) => transaction.to ? [transaction.to.toLowerCase()] : []),
      ...receipts.flatMap((receipt) => receipt.logs.map((log) => log.address.toLowerCase())),
    ])];

    const now =
      new Date();

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
            block
              .baseFeePerGas,
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
        block
          .transactionsRoot ??
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
        now,
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
            transaction
              .gasPrice
              ? hexToBigInt(
                transaction
                  .gasPrice,
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
            now,
        }),
      );

    const receiptRows =
      receipts.map(
        (receipt) => ({
          transactionHash:
            receipt
              .transactionHash
              .toLowerCase(),

          blockNumber:
            hexToBigInt(
              receipt
                .blockNumber,
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
                    log
                      .blockNumber,
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
                  log
                    .topics[0] ??
                  null,

                topic1:
                  log
                    .topics[1] ??
                  null,

                topic2:
                  log
                    .topics[2] ??
                  null,

                topic3:
                  log
                    .topics[3] ??
                  null,

                data:
                  log.data,

                removed:
                  log.removed,
              };
            },
          ),
      );

    const blockEvent =
      this.eventFactory
        .createBlockIndexed({
          chainId,

          networkName,

          blockNumber,

          blockHash,

          parentHash:
            blockRow.parentHash,

          timestamp:
            blockRow.timestamp,

          transactionCount:
            block.transactions
              .length,

          logCount:
            logRows.length,

          tokenTransfers:
            tokenData
              .transfers,
        });

    const transferEvents =
      this.eventFactory
        .createTokenTransfers(
          chainId,
          networkName,
          tokenData.transfers,
          tokenData.tokens,
        );

    const events = [
      blockEvent,
      ...transferEvents,
    ];

    await this.database.db
      .transaction(
        async (tx) => {
          /*
           * BLOCK
           */
          await tx
            .insert(blocks)
            .values(
              blockRow,
            )
            .onConflictDoUpdate({
              target:
                blocks.number,

              set: {
                hash:
                  blockRow.hash,

                parentHash:
                  blockRow
                    .parentHash,

                miner:
                  blockRow.miner,

                timestamp:
                  blockRow
                    .timestamp,

                gasLimit:
                  blockRow
                    .gasLimit,

                gasUsed:
                  blockRow
                    .gasUsed,

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
                  blockRow
                    .extraData,

                indexedAt:
                  now,
              },
            });

          /*
           * TRANSACTIONS
           */
          for (
            const chunk of
            chunkArray(
              transactionRows,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                transactionsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }

          /*
           * RECEIPTS
           */
          for (
            const chunk of
            chunkArray(
              receiptRows,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                receiptsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }

          /*
           * RAW EVENT LOGS
           */
          for (
            const chunk of
            chunkArray(
              logRows,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                logsTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }

          /*
           * TOKENS
           */
          for (
            const token of
            tokenData.tokens
          ) {
            await tx
              .insert(
                tokensTable,
              )
              .values(token)
              .onConflictDoUpdate({
                target:
                  tokensTable
                    .address,

                set: {
                  name:
                    sql`COALESCE(EXCLUDED.name, ${tokensTable.name})`,

                  symbol:
                    sql`COALESCE(EXCLUDED.symbol, ${tokensTable.symbol})`,

                  decimals:
                    sql`COALESCE(EXCLUDED.decimals, ${tokensTable.decimals})`,

                  totalSupply:
                    sql`COALESCE(EXCLUDED.total_supply, ${tokensTable.totalSupply})`,

                  firstSeenBlock:
                    sql`LEAST(
                      COALESCE(${tokensTable.firstSeenBlock}, EXCLUDED.first_seen_block),
                      EXCLUDED.first_seen_block
                    )`,

                  lastUpdatedBlock:
                    sql`GREATEST(
                      COALESCE(${tokensTable.lastUpdatedBlock}, EXCLUDED.last_updated_block),
                      EXCLUDED.last_updated_block
                    )`,

                  updatedAt:
                    now,
                },
              });
          }

          /*
           * ERC-20 TRANSFERS
           */
          for (
            const chunk of
            chunkArray(
              tokenData.transfers,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                tokenTransfersTable,
              )
              .values(chunk)
              .onConflictDoNothing();
          }

          /*
           * ADDRESSES
           */
          for (
            const chunk of
            chunkArray(
              addressRows,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                addressesTable,
              )
              .values(chunk)
              .onConflictDoUpdate({
                target:
                  addressesTable
                    .address,

                set: {
                  isContract:
                    sql`${addressesTable.isContract} OR EXCLUDED.is_contract`,
                  codeCheckedBlock: sql`CASE WHEN EXCLUDED.is_contract THEN COALESCE(${addressesTable.codeCheckedBlock}, EXCLUDED.code_checked_block) ELSE ${addressesTable.codeCheckedBlock} END`,

                  firstSeenBlock:
                    sql`LEAST(
                      COALESCE(${addressesTable.firstSeenBlock}, EXCLUDED.first_seen_block),
                      EXCLUDED.first_seen_block
                    )`,

                  lastSeenBlock:
                    sql`GREATEST(
                      COALESCE(${addressesTable.lastSeenBlock}, EXCLUDED.last_seen_block),
                      EXCLUDED.last_seen_block
                    )`,

                  updatedAt:
                    now,
                },
              });
          }

          // Persist enrichment intents atomically with canonical data. Providers and Redis stay outside ingestion.
          await this.advancedRepository.recordBlockIntents(tx, blockNumber, blockHash, contractCandidates, this.advancedOptions);

          /*
           * INDEXER STATE
           */
          await tx
            .insert(
              syncState,
            )
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
                now,
            })
            .onConflictDoUpdate({
              target:
                syncState
                  .chainId,

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
                  now,
              },
            });


          /*
 * TRANSACTIONAL OUTBOX
 */
          for (
            const chunk of
            chunkArray(
              events,
              250,
            )
          ) {
            if (
              chunk.length ===
              0
            ) {
              continue;
            }

            await tx
              .insert(
                outboxEvents,
              )
              .values(
                chunk.map(
                  (
                    event,
                  ) => ({
                    id:
                      event.id,

                    eventType:
                      event.type,

                    aggregateType:
                      event.type ===
                        'block.indexed.v1'
                        ? 'block'
                        : 'token-transfer',

                    aggregateId:
                      event.type ===
                        'block.indexed.v1'
                        ? event
                          .payload
                          .blockNumber
                        : `${event.payload.transactionHash}:${event.payload.logIndex}`,

                    payload:
                      event,

                    status:
                      'pending',

                    attempts:
                      0,

                    availableAt:
                      now,

                    createdAt:
                      now,
                  }),
                ),
              )
              .onConflictDoNothing();
          }

          /*
           * CHECKPOINT
           */
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
                  now,
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
                    now,
                },
              });
          }
        },
      );

    this.logger.log(
      [
        `Indexed block ${blockNumber}`,
        `${block.transactions.length} tx`,
        `${logRows.length} logs`,
        `${tokenData.transfers.length} ERC20 transfers`,
        `${tokenData.tokens.length} tokens`,
      ].join(
        ' | ',
      ),
    );
  }
}
// Block, transaction, receipt және smart-contract log-тарды бір PostgreSQL transaction ішінде сақтайды. Бір бөлігі қате болса, block толық rollback болады.
// Бұл — indexer-дің негізгі ядросы.
// Бір block-ты толық өңдейді: transaction, receipt, raw log, ERC-20 transfer, token және address деректерін бір PostgreSQL transaction ішінде сақтайды.
// Blockchain data мен event бір PostgreSQL transaction ішінде сақталады. Database commit болса event міндетті түрде outbox-та болады.
