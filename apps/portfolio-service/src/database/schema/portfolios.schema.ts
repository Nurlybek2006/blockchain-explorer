import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .notNull(),

    name: varchar('name', {
      length: 100,
    })
      .notNull()
      .default('Main Portfolio'),

    walletAddress: varchar(
      'wallet_address',
      {
        length: 42,
      },
    ).notNull(),

    chainId: integer('chain_id')
      .notNull()
      .default(1),

    isPrimary: boolean('is_primary')
      .notNull()
      .default(false),

    archivedAt: timestamp(
      'archived_at',
      {
        withTimezone: true,
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
    uniqueIndex(
      'portfolios_user_wallet_chain_uq',
    ).on(
      table.userId,
      table.walletAddress,
      table.chainId,
    ),

    index('portfolios_user_id_idx')
      .on(table.userId),

    index('portfolios_wallet_idx')
      .on(table.walletAddress),
  ],
);
// User бақылайтын Ethereum wallet-тарды portfolio ретінде сақтайды.