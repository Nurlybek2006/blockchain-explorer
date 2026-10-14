import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type {
  NodePgDatabase,
  NodePgTransaction,
} from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { TransactionTraceEntry } from '@blockchain-explorer/contracts';
import { DatabaseService } from '../../database/database.service.js';
import * as schema from '../../database/schema/index.js';
import {
  addresses,
  blocks,
  contractVerifications,
  transactions,
  transactionTraceRequests,
  transactionTraces,
  outboxEvents,
} from '../../database/schema/index.js';
import type { VerificationLookup } from './etherscan.client.js';
import type { AdvancedConfig } from './advanced.config.js';
import { recordCounter } from '@blockchain-explorer/observability';

export type ExplorerTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type ExplorerDb = NodePgDatabase<typeof schema> | ExplorerTransaction;
export type TraceRequestRow = typeof transactionTraceRequests.$inferSelect;

@Injectable()
export class AdvancedExplorerRepository {
  constructor(private readonly database: DatabaseService) {}

  async blockTraceContext(blockNumber: bigint, blockHash: string): Promise<unknown> {
    // Reuse the durable block envelope instead of adding telemetry columns to business tables.
    // Older envelopes have no metadata and intentionally start an independent background trace.
    const [row] = await this.database.db.select({ payload: outboxEvents.payload }).from(outboxEvents)
      .where(and(eq(outboxEvents.eventType, 'block.indexed.v1'), eq(outboxEvents.aggregateId, blockNumber.toString()),
        sql`${outboxEvents.payload}->'payload'->>'blockHash' = ${blockHash}`))
      .orderBy(desc(outboxEvents.createdAt)).limit(1);
    const payload = row?.payload;
    if (typeof payload !== 'object' || payload === null || !('metadata' in payload)) return undefined;
    const metadata = payload.metadata;
    return typeof metadata === 'object' && metadata !== null && 'traceContext' in metadata ? metadata.traceContext : undefined;
  }

  async getAddress(
    address: string,
  ): Promise<typeof addresses.$inferSelect | null> {
    const [row] = await this.database.db
      .select()
      .from(addresses)
      .where(eq(addresses.address, address))
      .limit(1);
    return row ?? null;
  }
  async getVerification(
    address: string,
  ): Promise<typeof contractVerifications.$inferSelect | null> {
    const [row] = await this.database.db
      .select()
      .from(contractVerifications)
      .where(eq(contractVerifications.contractAddress, address))
      .limit(1);
    return row ?? null;
  }
  async ensureVerificationIntent(
    address: string,
    config: AdvancedConfig,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [registry] = await tx
        .select()
        .from(addresses)
        .where(
          and(eq(addresses.address, address), eq(addresses.isContract, true)),
        )
        .for('update');
      if (!registry) return;
      const height =
        registry.codeCheckedBlock ??
        registry.firstSeenBlock ??
        registry.lastSeenBlock;
      const [block] =
        height === null
          ? []
          : await tx
              .select({ hash: blocks.hash })
              .from(blocks)
              .where(eq(blocks.number, height))
              .limit(1);
      await tx
        .insert(contractVerifications)
        .values({
          contractAddress: address,
          discoveredBlock: height,
          discoveredBlockHash: block?.hash ?? null,
          status: config.verificationEnabled ? 'pending' : 'unsupported',
          verifiedAt: null,
          nextAttemptAt: config.verificationEnabled ? new Date() : null,
        })
        .onConflictDoNothing();
    });
  }
  async getTransaction(
    hash: string,
  ): Promise<typeof transactions.$inferSelect | null> {
    const [row] = await this.database.db
      .select()
      .from(transactions)
      .where(eq(transactions.hash, hash))
      .limit(1);
    return row ?? null;
  }
  async getTraceRequest(hash: string): Promise<TraceRequestRow | null> {
    const [row] = await this.database.db
      .select()
      .from(transactionTraceRequests)
      .where(eq(transactionTraceRequests.transactionHash, hash))
      .limit(1);
    return row ?? null;
  }
  async getTraces(hash: string) {
    return this.database.db
      .select()
      .from(transactionTraces)
      .where(eq(transactionTraces.transactionHash, hash));
  }

  /** Called inside the canonical block transaction, before commit. No Redis/provider calls. */
  async recordBlockIntents(
    tx: ExplorerTransaction,
    blockNumber: bigint,
    blockHash: string,
    candidates: string[],
    config: AdvancedConfig,
  ): Promise<number> {
    let discoveries = 0;
    if (candidates.length) {
      await tx
        .update(addresses)
        .set({
          codeCheckAfter: sql`COALESCE(${addresses.codeCheckAfter}, now())`,
        })
        .where(
          and(
            inArray(addresses.address, candidates),
            eq(addresses.isContract, false),
            isNull(addresses.codeCheckedBlock),
          ),
        );
    }
    const known = await tx
      .select({ address: addresses.address })
      .from(addresses)
      .where(
        and(
          eq(addresses.isContract, true),
          eq(addresses.lastSeenBlock, blockNumber),
        ),
      );
    if (known.length) {
      const inserted = await tx
        .insert(contractVerifications)
        .values(
          known.map((row): typeof contractVerifications.$inferInsert => ({
            contractAddress: row.address,
            discoveredBlock: blockNumber,
            discoveredBlockHash: blockHash,
            status: config.verificationEnabled ? 'pending' : 'unsupported',
            verifiedAt: null,
            nextAttemptAt: config.verificationEnabled ? new Date() : null,
          })),
        )
        .onConflictDoNothing()
        .returning({ address: contractVerifications.contractAddress });
      discoveries = inserted.length;
    }
    if (!config.traceEnabled) return discoveries;
    await this.insertTraceIntents(
      tx,
      blockNumber,
      blockHash,
      config.traceOnlyContracts,
    );
    return discoveries;
  }

  private async insertTraceIntents(
    db: ExplorerDb,
    blockNumber: bigint,
    blockHash: string,
    onlyContracts: boolean,
  ): Promise<void> {
    const candidates = await db
      .select({ hash: transactions.hash, to: transactions.toAddress })
      .from(transactions)
      .where(
        and(
          eq(transactions.blockNumber, blockNumber),
          eq(transactions.blockHash, blockHash),
        ),
      );
    const targets = candidates.flatMap((row) => (row.to ? [row.to] : []));
    const known =
      onlyContracts && targets.length
        ? await db
            .select({ address: addresses.address })
            .from(addresses)
            .where(
              and(
                eq(addresses.isContract, true),
                inArray(addresses.address, targets),
              ),
            )
        : [];
    const contractSet = new Set(known.map((row) => row.address));
    const selected = candidates.filter(
      (row) => !onlyContracts || row.to === null || contractSet.has(row.to),
    );
    if (selected.length)
      await db
        .insert(transactionTraceRequests)
        .values(
          selected.map((row) => ({
            transactionHash: row.hash,
            blockNumber,
            blockHash,
          })),
        )
        .onConflictDoNothing();
  }

  async pendingDetections(limit = 10) {
    return this.database.db
      .select()
      .from(addresses)
      .where(
        and(
          eq(addresses.isContract, false),
          isNull(addresses.codeCheckedBlock),
          lte(addresses.codeCheckAfter, new Date()),
          sql`${addresses.codeCheckAttempts} < 3`,
        ),
      )
      .orderBy(asc(addresses.codeCheckAfter))
      .limit(limit);
  }
  async completeDetection(
    address: string,
    checkedBlock: bigint,
    isContract: boolean,
    config: AdvancedConfig,
  ): Promise<void> {
    const discovered = await this.database.db.transaction(async (tx) => {
      const [canonical] = await tx
        .select({ hash: blocks.hash })
        .from(blocks)
        .where(eq(blocks.number, checkedBlock))
        .limit(1);
      if (!canonical) return false;
      const rows = await tx
        .update(addresses)
        .set({
          isContract,
          codeCheckedBlock: checkedBlock,
          codeCheckAfter: null,
          codeCheckAttempts: 0,
          updatedAt: new Date(),
        })
        .where(
          and(eq(addresses.address, address), eq(addresses.isContract, false)),
        )
        .returning();
      if (!isContract || !rows.length) return false;
      await tx
        .insert(contractVerifications)
        .values({
          contractAddress: address,
          discoveredBlock: checkedBlock,
          discoveredBlockHash: canonical.hash,
          verifiedAt: null,
          status: config.verificationEnabled ? 'pending' : 'unsupported',
          nextAttemptAt: config.verificationEnabled ? new Date() : null,
        })
        .onConflictDoNothing();
      if (config.traceEnabled) {
        const matching = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.toAddress, address))
          .orderBy(
            desc(transactions.blockNumber),
            desc(transactions.transactionIndex),
          )
          .limit(1000);
        if (matching.length)
          await tx
            .insert(transactionTraceRequests)
            .values(
              matching.map((row) => ({
                transactionHash: row.hash,
                blockNumber: row.blockNumber,
                blockHash: row.blockHash,
              })),
            )
            .onConflictDoNothing();
      }
      return true;
    });
    if (discovered) recordCounter('indexer_contracts_discovered_total');
  }
  async failDetection(address: string): Promise<void> {
    await this.database.db
      .update(addresses)
      .set({
        codeCheckAttempts: sql`${addresses.codeCheckAttempts} + 1`,
        codeCheckAfter: new Date(Date.now() + 60000),
      })
      .where(
        and(eq(addresses.address, address), eq(addresses.isContract, false)),
      );
  }

  async dueVerifications(config: AdvancedConfig, limit = 10) {
    return this.database.db
      .select()
      .from(contractVerifications)
      .where(
        and(
          inArray(contractVerifications.status, [
            'pending',
            'unverified',
            'failed',
          ]),
          lte(contractVerifications.nextAttemptAt, new Date()),
          sql`${contractVerifications.attempts} < ${config.verificationMaxLookups}`,
        ),
      )
      .orderBy(asc(contractVerifications.nextAttemptAt))
      .limit(limit);
  }
  async deferVerification(
    address: string,
    attempts: number,
    until: Date,
  ): Promise<void> {
    await this.database.db
      .update(contractVerifications)
      .set({ nextAttemptAt: until })
      .where(
        and(
          eq(contractVerifications.contractAddress, address),
          eq(contractVerifications.attempts, attempts),
        ),
      );
  }
  async claimVerification(
    address: string,
    expectedAttempts: number,
    blockHash: string | null = null,
  ): Promise<typeof contractVerifications.$inferSelect | null> {
    const [row] = await this.database.db
      .update(contractVerifications)
      .set({
        status: 'pending',
        attempts: sql`${contractVerifications.attempts} + 1`,
        nextAttemptAt: new Date(Date.now() + 600000),
      })
      .where(
        and(
          eq(contractVerifications.contractAddress, address),
          blockHash === null
            ? isNull(contractVerifications.discoveredBlockHash)
            : eq(contractVerifications.discoveredBlockHash, blockHash),
          eq(contractVerifications.attempts, expectedAttempts),
          inArray(contractVerifications.status, [
            'pending',
            'unverified',
            'failed',
          ]),
        ),
      )
      .returning();
    return row ?? null;
  }
  async completeVerification(
    address: string,
    result: VerificationLookup,
    attempts: number,
    config: AdvancedConfig,
    blockHash: string | null = null,
  ): Promise<void> {
    const { verified, ...stored } = result;
    const rows = await this.database.db
      .update(contractVerifications)
      .set({
        ...stored,
        verifiedAt: verified ? new Date() : null,
        lastCheckedAt: new Date(),
        lastError: null,
        nextAttemptAt:
          result.status === 'unverified' &&
          attempts < config.verificationMaxLookups
            ? new Date(Date.now() + config.verificationCooldownMs)
            : null,
      })
      .where(
        and(
          eq(contractVerifications.contractAddress, address),
          blockHash === null
            ? isNull(contractVerifications.discoveredBlockHash)
            : eq(contractVerifications.discoveredBlockHash, blockHash),
          eq(contractVerifications.attempts, attempts),
        ),
      )
      .returning({ address: contractVerifications.contractAddress });
    if (rows.length && (result.status === 'verified' || result.status === 'unverified')) {
      recordCounter('indexer_contract_verification_total', rows.length, { status: result.status });
    }
  }
  async failVerification(
    address: string,
    attempts: number,
    code: string,
    config: AdvancedConfig,
    blockHash: string | null = null,
  ): Promise<void> {
    const rows = await this.database.db
      .update(contractVerifications)
      .set({
        status: 'failed',
        lastCheckedAt: new Date(),
        lastError: code.slice(0, 255),
        nextAttemptAt:
          attempts < config.verificationMaxLookups
            ? new Date(Date.now() + config.verificationCooldownMs)
            : null,
      })
      .where(
        and(
          eq(contractVerifications.contractAddress, address),
          blockHash === null
            ? isNull(contractVerifications.discoveredBlockHash)
            : eq(contractVerifications.discoveredBlockHash, blockHash),
          eq(contractVerifications.attempts, attempts),
        ),
      )
      .returning({ address: contractVerifications.contractAddress });
    if (rows.length) recordCounter('indexer_contract_verification_total', rows.length, { status: 'failed' });
  }

  async requestTrace(hash: string, config: AdvancedConfig): Promise<void> {
    if (!config.traceEnabled) return;
    const transaction = await this.getTransaction(hash);
    if (!transaction) return;
    if (config.traceOnlyContracts && transaction.toAddress) {
      const address = await this.getAddress(transaction.toAddress);
      if (!address?.isContract) return;
    }
    await this.database.db
      .insert(transactionTraceRequests)
      .values({
        transactionHash: hash,
        blockNumber: transaction.blockNumber,
        blockHash: transaction.blockHash,
      })
      .onConflictDoNothing();
  }
  async dueTraces(limit = 10) {
    return this.database.db
      .select()
      .from(transactionTraceRequests)
      .where(
        and(
          inArray(transactionTraceRequests.status, ['queued', 'processing']),
          lte(transactionTraceRequests.availableAt, new Date()),
        ),
      )
      .orderBy(asc(transactionTraceRequests.availableAt))
      .limit(limit);
  }
  async deferTrace(hash: string, attempts: number, until: Date): Promise<void> {
    await this.database.db
      .update(transactionTraceRequests)
      .set({ availableAt: until })
      .where(
        and(
          eq(transactionTraceRequests.transactionHash, hash),
          eq(transactionTraceRequests.attempts, attempts),
        ),
      );
  }
  async claimTrace(
    hash: string,
    blockHash: string,
    maximumAttempts: number,
  ): Promise<TraceRequestRow | null> {
    const [row] = await this.database.db
      .update(transactionTraceRequests)
      .set({
        status: 'processing',
        attempts: sql`${transactionTraceRequests.attempts} + 1`,
        updatedAt: new Date(),
        availableAt: new Date(Date.now() + 120000),
      })
      .where(
        and(
          eq(transactionTraceRequests.transactionHash, hash),
          eq(transactionTraceRequests.blockHash, blockHash),
          inArray(transactionTraceRequests.status, ['queued', 'processing']),
          sql`${transactionTraceRequests.attempts} < ${maximumAttempts}`,
        ),
      )
      .returning();
    return row ?? null;
  }
  async completeTrace(
    request: TraceRequestRow,
    traces: TransactionTraceEntry[],
  ): Promise<void> {
    const completed = await this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(transactionTraceRequests)
        .where(
          and(
            eq(
              transactionTraceRequests.transactionHash,
              request.transactionHash,
            ),
            eq(transactionTraceRequests.blockHash, request.blockHash),
          ),
        )
        .for('update');
      if (
        !current ||
        current.attempts !== request.attempts ||
        current.status !== 'processing'
      )
        return false;
      await tx
        .delete(transactionTraces)
        .where(eq(transactionTraces.transactionHash, request.transactionHash));
      for (let offset = 0; offset < traces.length; offset += 250) {
        await tx
          .insert(transactionTraces)
          .values(
            traces.slice(offset, offset + 250).map((row) => ({
              transactionHash: row.transactionHash,
              blockNumber: request.blockNumber,
              traceAddress: row.traceAddress,
              type: row.type,
              callType: row.callType,
              fromAddress: row.fromAddress,
              toAddress: row.toAddress,
              value: row.value,
              gas: row.gas,
              gasUsed: row.gasUsed,
              input: row.input,
              output: row.output,
              error: row.error,
            })),
          )
          .onConflictDoNothing();
      }
      await tx
        .update(transactionTraceRequests)
        .set({ status: 'completed', lastError: null, updatedAt: new Date() })
        .where(
          eq(transactionTraceRequests.transactionHash, request.transactionHash),
        );
      return true;
    });
    if (completed) recordCounter('indexer_traces_total', 1, { status: 'completed' });
  }
  async failTrace(
    request: TraceRequestRow,
    unsupported: boolean,
    maximumAttempts: number,
  ): Promise<void> {
    const rows = await this.database.db
      .update(transactionTraceRequests)
      .set({
        status: unsupported
          ? 'unsupported'
          : request.attempts >= maximumAttempts
            ? 'failed'
            : 'queued',
        lastError: unsupported
          ? 'provider-not-supported'
          : 'trace-request-failed',
        availableAt: new Date(
          Date.now() + Math.min(1000 * 2 ** request.attempts, 60000),
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transactionTraceRequests.transactionHash, request.transactionHash),
          eq(transactionTraceRequests.blockHash, request.blockHash),
          eq(transactionTraceRequests.attempts, request.attempts),
        ),
      )
      .returning({ status: transactionTraceRequests.status });
    for (const row of rows) if (row.status === 'unsupported' || row.status === 'failed') {
      recordCounter('indexer_traces_total', 1, { status: row.status });
    }
  }
}
