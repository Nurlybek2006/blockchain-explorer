import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { blocks } from './blocks.schema.js';
import { tokens } from './tokens.schema.js';
import { transactions } from './transactions.schema.js';

export const tokenTransfers = pgTable(
  'token_transfers',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    transactionHash: varchar(
      'transaction_hash',
      {
        length: 66,
      },
    )
      .notNull()
      .references(
        () => transactions.hash,
        {
          onDelete: 'cascade',
        },
      ),

    blockNumber: bigint('block_number', {
      mode: 'bigint',
    })
      .notNull()
      .references(
        () => blocks.number,
        {
          onDelete: 'cascade',
        },
      ),

    tokenAddress: varchar(
      'token_address',
      {
        length: 42,
      },
    )
      .notNull()
      .references(
        () => tokens.address,
        {
          onDelete: 'cascade',
        },
      ),

    fromAddress: varchar(
      'from_address',
      {
        length: 42,
      },
    ).notNull(),

    toAddress: varchar('to_address', {
      length: 42,
    }).notNull(),

    amount: numeric('amount', {
      precision: 78,
      scale: 0,
    }).notNull(),

    transactionIndex: integer(
      'transaction_index',
    ).notNull(),

    logIndex: integer('log_index')
      .notNull(),

    removed: boolean('removed')
      .notNull()
      .default(false),

    indexedAt: timestamp('indexed_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    uniqueIndex(
      'token_transfers_tx_log_uq',
    ).on(
      table.transactionHash,
      table.logIndex,
    ),

    index(
      'token_transfers_token_idx',
    ).on(table.tokenAddress),

    index(
      'token_transfers_from_idx',
    ).on(table.fromAddress),

    index(
      'token_transfers_to_idx',
    ).on(table.toAddress),

    index(
      'token_transfers_block_idx',
    ).on(table.blockNumber),
  ],
);
// ERC-20 токендердің кімнен кімге және қанша жіберілгенін сақтайды.
// Token transfer-ларды сақтайды. ERC-20 Transfer event-тері дәл осы кестеге жазылады.