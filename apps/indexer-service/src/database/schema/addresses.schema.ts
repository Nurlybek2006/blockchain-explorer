import {
  bigint,
  boolean,
  index,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const addresses = pgTable(
  'addresses',
  {
    address: varchar('address', {
      length: 42,
    }).primaryKey(),

    isContract: boolean('is_contract')
      .notNull()
      .default(false),

    nativeBalanceWei: numeric(
      'native_balance_wei',
      {
        precision: 78,
        scale: 0,
      },
    )
      .notNull()
      .default('0'),

    transactionCount: numeric(
      'transaction_count',
      {
        precision: 78,
        scale: 0,
      },
    )
      .notNull()
      .default('0'),

    firstSeenBlock: bigint(
      'first_seen_block',
      {
        mode: 'bigint',
      },
    ),

    lastSeenBlock: bigint(
      'last_seen_block',
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
    index('addresses_last_seen_idx')
      .on(table.lastSeenBlock),
  ],
);
// Explorer-де address page-ты тез көрсету үшін Ethereum address туралы агрегатталған ақпаратты сақтайды.