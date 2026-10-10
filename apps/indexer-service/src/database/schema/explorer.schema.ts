import {
  bigint,
  integer,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const blocks = pgTable('blocks', {
  number: bigint('number', {
    mode: 'bigint',
  }).primaryKey(),

  hash: varchar('hash', {
    length: 66,
  })
    .notNull()
    .unique(),

  parentHash: varchar('parent_hash', {
    length: 66,
  }).notNull(),

  miner: varchar('miner', {
    length: 42,
  }),

  timestamp: timestamp('timestamp', {
    withTimezone: true,
  }).notNull(),

  gasLimit: numeric('gas_limit', {
    precision: 78,
    scale: 0,
  }).notNull(),

  gasUsed: numeric('gas_used', {
    precision: 78,
    scale: 0,
  }).notNull(),

  baseFeePerGas: numeric('base_fee_per_gas', {
    precision: 78,
    scale: 0,
  }),

  transactionCount: integer('transaction_count')
    .notNull()
    .default(0),

  indexedAt: timestamp('indexed_at', {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});