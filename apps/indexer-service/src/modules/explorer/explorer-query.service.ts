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

@Injectable()
export class ExplorerQueryService {
    constructor(
        private readonly database:
            DatabaseService,
    ) { }

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