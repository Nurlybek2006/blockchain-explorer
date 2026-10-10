import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const blocks = pgTable(
  'blocks',
  {
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

    baseFeePerGas: numeric(
      'base_fee_per_gas',
      {
        precision: 78,
        scale: 0,
      },
    ),

    size: integer('size'),

    transactionCount: integer(
      'transaction_count',
    )
      .notNull()
      .default(0),

    transactionsRoot: varchar(
      'transactions_root',
      {
        length: 66,
      },
    ),

    stateRoot: varchar('state_root', {
      length: 66,
    }),

    receiptsRoot: varchar(
      'receipts_root',
      {
        length: 66,
      },
    ),

    extraData: text('extra_data'),

    indexedAt: timestamp('indexed_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index('blocks_timestamp_idx')
      .on(table.timestamp),

    index('blocks_miner_idx')
      .on(table.miner),
  ],
);
// Ethereum block-тарының негізгі ақпаратын сақтайды. Бұл Explorer-дің Block Details бетінің негізгі кестесі