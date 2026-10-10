import {
  bigint,
  index,
  numeric,
  pgTable,
  smallint,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const tokens = pgTable(
  'tokens',
  {
    address: varchar('address', {
      length: 42,
    }).primaryKey(),

    name: varchar('name', {
      length: 255,
    }),

    symbol: varchar('symbol', {
      length: 64,
    }),

    decimals: smallint('decimals'),

    totalSupply: numeric(
      'total_supply',
      {
        precision: 78,
        scale: 0,
      },
    ),

    firstSeenBlock: bigint(
      'first_seen_block',
      {
        mode: 'bigint',
      },
    ),

    lastUpdatedBlock: bigint(
      'last_updated_block',
      {
        mode: 'bigint',
      },
    ),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index('tokens_symbol_idx')
      .on(table.symbol),
  ],
);
// Indexer тапқан ERC-20 токендердің metadata-сын сақтайды.