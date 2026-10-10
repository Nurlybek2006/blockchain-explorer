import {
  bigint,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    chainId: integer('chain_id')
      .notNull(),

    blockNumber: bigint('block_number', {
      mode: 'bigint',
    }).notNull(),

    blockHash: varchar('block_hash', {
      length: 66,
    }).notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    uniqueIndex(
      'checkpoints_chain_block_uq',
    ).on(
      table.chainId,
      table.blockNumber,
    ),

    index(
      'checkpoints_created_at_idx',
    ).on(table.createdAt),
  ],
);
// Blockchain reorg болғанда бұрынғы дұрыс block hash-пен салыстыру үшін checkpoint сақтайды.