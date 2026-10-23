import {
    Injectable,
} from '@nestjs/common';

import {
    asc,
    count,
    desc,
    eq,
    or,
} from 'drizzle-orm';

import {
    DatabaseService,
} from '../../database/database.service.js';

import {
    addresses,
    blocks,
    logs,
    receipts,
    tokenTransfers,
    tokens,
    transactions,
} from '../../database/schema/index.js';
import { resolveIndexedSearch } from './search-resolution.js';

import { sql } from 'drizzle-orm';
import { decodeWalletActivity } from '@blockchain-explorer/contracts';

@Injectable()
export class ExplorerQueryService {
    constructor(
        private readonly database:
            DatabaseService,
    ) { }

    async getBlockByHash(hash: string) {
        const [row] = await this.database.db.select({ number: blocks.number }).from(blocks).where(eq(blocks.hash, hash.toLowerCase())).limit(1);
        return row ? this.getBlock(row.number) : null;
    }

    async search(query: unknown) {
        return resolveIndexedSearch(query, {
            blockNumber: async number => { const [row] = await this.database.db.select({ number: blocks.number }).from(blocks).where(eq(blocks.number, BigInt(number))).limit(1); return row?.number.toString() ?? null; },
            transaction: async hash => { const [row] = await this.database.db.select({ hash: transactions.hash }).from(transactions).where(eq(transactions.hash, hash)).limit(1); return Boolean(row); },
            blockHash: async hash => { const [row] = await this.database.db.select({ number: blocks.number }).from(blocks).where(eq(blocks.hash, hash)).limit(1); return row?.number.toString() ?? null; },
            addressKind: async address => {
                const [token] = await this.database.db.select({ address: tokens.address }).from(tokens).where(eq(tokens.address, address)).limit(1);
                if (token) return 'token';
                const [row] = await this.database.db.select({ isContract: addresses.isContract }).from(addresses).where(eq(addresses.address, address)).limit(1);
                if (row) return row.isContract ? 'contract' : 'address';
                return (await this.getAddress(address, 1, 1)) ? 'address' : null;
            },
        });
    }

    async getStats() {
        const [
            latestBlocks,
            blockCountRows,
            txCountRows,
            tokenCountRows,
            transferCountRows,
        ] =
            await Promise.all([
                this.database.db
                    .select({
                        number:
                            blocks.number,

                        timestamp:
                            blocks.timestamp,
                    })
                    .from(blocks)
                    .orderBy(
                        desc(
                            blocks.number,
                        ),
                    )
                    .limit(1),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(blocks),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(
                        transactions,
                    ),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(tokens),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(
                        tokenTransfers,
                    ),
            ]);

        return {
            latestBlock:
                latestBlocks[0] ??
                null,

            blocks:
                Number(
                    blockCountRows[0]
                        ?.total ??
                    0,
                ),

            transactions:
                Number(
                    txCountRows[0]
                        ?.total ??
                    0,
                ),

            tokens:
                Number(
                    tokenCountRows[0]
                        ?.total ??
                    0,
                ),

            tokenTransfers:
                Number(
                    transferCountRows[0]
                        ?.total ??
                    0,
                ),
        };
    }

    async getBlocks(
        page: number,
        limit: number,
    ) {
        const offset =
            (page - 1) *
            limit;

        const [
            rows,
            totalRows,
        ] =
            await Promise.all([
                this.database.db
                    .select()
                    .from(blocks)
                    .orderBy(
                        desc(
                            blocks.number,
                        ),
                    )
                    .limit(limit)
                    .offset(
                        offset,
                    ),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(blocks),
            ]);

        return this.paginate(
            rows,
            page,
            limit,
            Number(
                totalRows[0]
                    ?.total ??
                0,
            ),
        );
    }

    async getBlock(
        blockNumber: bigint,
    ) {
        const [block] =
            await this.database.db
                .select()
                .from(blocks)
                .where(
                    eq(
                        blocks.number,
                        blockNumber,
                    ),
                )
                .limit(1);

        if (!block) {
            return null;
        }

        const blockTransactions =
            await this.database.db
                .select()
                .from(
                    transactions,
                )
                .where(
                    eq(
                        transactions
                            .blockNumber,
                        blockNumber,
                    ),
                )
                .orderBy(
                    asc(
                        transactions
                            .transactionIndex,
                    ),
                );

        return {
            ...block,

            transactions:
                blockTransactions,
        };
    }

    async getTransaction(
        hash: string,
    ) {
        const normalized =
            hash.toLowerCase();

        const [transaction] =
            await this.database.db
                .select()
                .from(
                    transactions,
                )
                .where(
                    eq(
                        transactions.hash,
                        normalized,
                    ),
                )
                .limit(1);

        if (!transaction) {
            return null;
        }

        const [
            receiptRows,
            logRows,
            transferRows,
        ] =
            await Promise.all([
                this.database.db
                    .select()
                    .from(receipts)
                    .where(
                        eq(
                            receipts
                                .transactionHash,
                            normalized,
                        ),
                    )
                    .limit(1),

                this.database.db
                    .select()
                    .from(logs)
                    .where(
                        eq(
                            logs
                                .transactionHash,
                            normalized,
                        ),
                    )
                    .orderBy(
                        asc(
                            logs.logIndex,
                        ),
                    ),

                this.database.db
                    .select()
                    .from(
                        tokenTransfers,
                    )
                    .where(
                        eq(
                            tokenTransfers
                                .transactionHash,
                            normalized,
                        ),
                    )
                    .orderBy(
                        asc(
                            tokenTransfers
                                .logIndex,
                        ),
                    ),
            ]);

        return {
            transaction,

            receipt:
                receiptRows[0] ??
                null,

            logs:
                logRows,

            tokenTransfers:
                transferRows,
        };
    }

    async getAddress(
        address: string,
        page: number,
        limit: number,
    ) {
        const normalized =
            address.toLowerCase();

        const offset =
            (page - 1) *
            limit;

        const [
            addressRows,
            txRows,
            txCountRows,
            transferRows,
            transferCountRows,
        ] =
            await Promise.all([
                this.database.db
                    .select()
                    .from(addresses)
                    .where(
                        eq(
                            addresses.address,
                            normalized,
                        ),
                    )
                    .limit(1),

                this.database.db
                    .select()
                    .from(
                        transactions,
                    )
                    .where(
                        or(
                            eq(
                                transactions
                                    .fromAddress,
                                normalized,
                            ),

                            eq(
                                transactions
                                    .toAddress,
                                normalized,
                            ),
                        ),
                    )
                    .orderBy(
                        desc(
                            transactions
                                .blockNumber,
                        ),
                    )
                    .limit(limit)
                    .offset(
                        offset,
                    ),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(
                        transactions,
                    )
                    .where(
                        or(
                            eq(
                                transactions
                                    .fromAddress,
                                normalized,
                            ),

                            eq(
                                transactions
                                    .toAddress,
                                normalized,
                            ),
                        ),
                    ),

                this.database.db
                    .select()
                    .from(
                        tokenTransfers,
                    )
                    .where(
                        or(
                            eq(
                                tokenTransfers
                                    .fromAddress,
                                normalized,
                            ),

                            eq(
                                tokenTransfers
                                    .toAddress,
                                normalized,
                            ),
                        ),
                    )
                    .orderBy(
                        desc(
                            tokenTransfers
                                .blockNumber,
                        ),
                    )
                    .limit(limit),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(
                        tokenTransfers,
                    )
                    .where(
                        or(
                            eq(
                                tokenTransfers
                                    .fromAddress,
                                normalized,
                            ),

                            eq(
                                tokenTransfers
                                    .toAddress,
                                normalized,
                            ),
                        ),
                    ),
            ]);

        const entity =
            addressRows[0] ??
            null;

        const txTotal =
            Number(
                txCountRows[0]
                    ?.total ??
                0,
            );

        const transferTotal =
            Number(
                transferCountRows[0]
                    ?.total ??
                0,
            );

        if (
            !entity &&
            txTotal === 0 &&
            transferTotal === 0
        ) {
            return null;
        }

        return {
            address:
                entity ?? {
                    address:
                        normalized,

                    isContract:
                        false,
                },

            transactionCount:
                txTotal,

            tokenTransferCount:
                transferTotal,

            transactions:
                txRows,

            tokenTransfers:
                transferRows,

            pagination: {
                page,

                limit,

                total:
                    txTotal,

                totalPages:
                    Math.ceil(
                        txTotal /
                        limit,
                    ),
            },
        };
    }

    async getTokens(
        page: number,
        limit: number,
    ) {
        const offset =
            (page - 1) *
            limit;

        const [
            rows,
            totalRows,
        ] =
            await Promise.all([
                this.database.db
                    .select()
                    .from(tokens)
                    .orderBy(
                        desc(
                            tokens
                                .lastUpdatedBlock,
                        ),
                    )
                    .limit(limit)
                    .offset(
                        offset,
                    ),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(tokens),
            ]);

        return this.paginate(
            rows,
            page,
            limit,
            Number(
                totalRows[0]
                    ?.total ??
                0,
            ),
        );
    }

    async getToken(
        address: string,
        page: number,
        limit: number,
    ) {
        const normalized =
            address.toLowerCase();

        const offset =
            (page - 1) *
            limit;

        const [
            tokenRows,
            transferRows,
            countRows,
        ] =
            await Promise.all([
                this.database.db
                    .select()
                    .from(tokens)
                    .where(
                        eq(
                            tokens.address,
                            normalized,
                        ),
                    )
                    .limit(1),

                this.database.db
                    .select()
                    .from(
                        tokenTransfers,
                    )
                    .where(
                        eq(
                            tokenTransfers
                                .tokenAddress,
                            normalized,
                        ),
                    )
                    .orderBy(
                        desc(
                            tokenTransfers
                                .blockNumber,
                        ),
                    )
                    .limit(limit)
                    .offset(
                        offset,
                    ),

                this.database.db
                    .select({
                        total:
                            count(),
                    })
                    .from(
                        tokenTransfers,
                    )
                    .where(
                        eq(
                            tokenTransfers
                                .tokenAddress,
                            normalized,
                        ),
                    ),
            ]);

        const token =
            tokenRows[0];

        if (!token) {
            return null;
        }

        const total =
            Number(
                countRows[0]
                    ?.total ??
                0,
            );

        return {
            token,

            transfers:
                transferRows,

            pagination: {
                page,

                limit,

                total,

                totalPages:
                    Math.ceil(
                        total /
                        limit,
                    ),
            },
        };
    }


    async getActivity(
        address: string,
        page: number,
        limit: number,
    ) {
        const normalized = address.toLowerCase();
        const offset = (page - 1) * limit;

        const result = await this.database.db.execute(sql`
    WITH activity AS (
      SELECT
        'native:' || t.hash AS id,
        t.hash AS "transactionHash",
        t.block_number AS "blockNumber",
        t.transaction_index AS "transactionIndex",
        -1 AS "logIndex",
        b.timestamp AS timestamp,
        CASE
          WHEN t.from_address = ${normalized}
            AND COALESCE(t.to_address, r.contract_address) = ${normalized}
            THEN 'self'
          WHEN COALESCE(t.to_address, r.contract_address) = ${normalized}
            THEN 'received'
          ELSE 'sent'
        END AS direction,
        'native' AS "assetType",
        NULL::text AS "tokenAddress",
        'ETH' AS symbol,
        18 AS decimals,
        t.value::text AS "amountRaw",
        t.from_address AS "fromAddress",
        COALESCE(t.to_address, r.contract_address) AS "toAddress"
      FROM transactions t
      INNER JOIN blocks b
        ON b.number = t.block_number
        AND b.hash = t.block_hash
      INNER JOIN receipts r
        ON r.transaction_hash = t.hash
        AND r.block_number = t.block_number
      WHERE
        r.status = true
        AND t.value > 0
        AND COALESCE(t.to_address, r.contract_address) IS NOT NULL
        AND (
          t.from_address = ${normalized}
          OR COALESCE(t.to_address, r.contract_address) = ${normalized}
        )

      UNION ALL

      SELECT
        'erc20:' || tr.transaction_hash || ':' || tr.log_index::text AS id,
        tr.transaction_hash AS "transactionHash",
        tr.block_number AS "blockNumber",
        tr.transaction_index AS "transactionIndex",
        tr.log_index AS "logIndex",
        b.timestamp AS timestamp,
        CASE
          WHEN tr.from_address = ${normalized}
            AND tr.to_address = ${normalized}
            THEN 'self'
          WHEN tr.to_address = ${normalized}
            THEN 'received'
          ELSE 'sent'
        END AS direction,
        'erc20' AS "assetType",
        tr.token_address AS "tokenAddress",
        tk.symbol AS symbol,
        tk.decimals AS decimals,
        tr.amount::text AS "amountRaw",
        tr.from_address AS "fromAddress",
        tr.to_address AS "toAddress"
      FROM token_transfers tr
      INNER JOIN transactions t
        ON t.hash = tr.transaction_hash
        AND t.block_number = tr.block_number
      INNER JOIN blocks b
        ON b.number = t.block_number
        AND b.hash = t.block_hash
      INNER JOIN receipts r
        ON r.transaction_hash = t.hash
        AND r.block_number = t.block_number
      INNER JOIN tokens tk
        ON tk.address = tr.token_address
      WHERE
        r.status = true
        AND tr.removed = false
        AND tr.amount > 0
        AND (
          tr.from_address = ${normalized}
          OR tr.to_address = ${normalized}
        )
    ),
    selected AS (
      SELECT *
      FROM activity
      ORDER BY
        "blockNumber" DESC,
        "transactionIndex" DESC,
        "logIndex" DESC,
        id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    ),
    totals AS (
      SELECT COUNT(*) AS total
      FROM activity
    )
    SELECT jsonb_build_object(
      'address', ${normalized}::text,
      'items', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'transactionHash', s."transactionHash",
              'blockNumber', s."blockNumber"::text,
              'timestamp', s.timestamp,
              'direction', s.direction,
              'assetType', s."assetType",
              'tokenAddress', s."tokenAddress",
              'symbol', s.symbol,
              'decimals', s.decimals,
              'amountRaw', s."amountRaw",
              'fromAddress', s."fromAddress",
              'toAddress', s."toAddress"
            )
            ORDER BY
              s."blockNumber" DESC,
              s."transactionIndex" DESC,
              s."logIndex" DESC,
              s.id DESC
          )
          FROM selected s
        ),
        '[]'::jsonb
      ),
      'pagination', jsonb_build_object(
        'page', ${page}::integer,
        'limit', ${limit}::integer,
        'total', totals.total,
        'totalPages', CEIL(totals.total::numeric / ${limit})::bigint
      )
    ) AS payload
    FROM totals
  `);

        return decodeWalletActivity(result.rows[0]?.payload);
    }

    private paginate<T>(
        data: T[],
        page: number,
        limit: number,
        total: number,
    ) {
        return {
            data,

            pagination: {
                page,

                limit,

                total,

                totalPages:
                    Math.ceil(
                        total /
                        limit,
                    ),
            },
        };
    }
}
// Explorer database-тан block, transaction, address, token және статистиканы оқитын негізгі query layer.
