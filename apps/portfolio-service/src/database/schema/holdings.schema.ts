import {
  bigint,
  index,
  numeric,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { portfolios } from './portfolios.schema.js';

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(
        () => portfolios.id,
        {
          onDelete: 'cascade',
        },
      ),

    assetKey: varchar('asset_key', {
      length: 128,
    }).notNull(),

    assetType: varchar('asset_type', {
      length: 20,
    }).notNull(),

    tokenAddress: varchar(
      'token_address',
      {
        length: 42,
      },
    ),

    symbol: varchar('symbol', {
      length: 64,
    }).notNull(),

    name: varchar('name', {
      length: 255,
    }),

    decimals: smallint('decimals')
      .notNull(),

    balanceRaw: numeric(
      'balance_raw',
      {
        precision: 78,
        scale: 0,
      },
    )
      .notNull()
      .default('0'),

    lastUpdatedBlock: bigint(
      'last_updated_block',
      {
        mode: 'bigint',
      },
    ),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    uniqueIndex(
      'holdings_portfolio_asset_uq',
    ).on(
      table.portfolioId,
      table.assetKey,
    ),

    index('holdings_token_idx')
      .on(table.tokenAddress),
  ],
);
// Wallet-тағы ETH және ERC-20 balance-тарды сақтайды.