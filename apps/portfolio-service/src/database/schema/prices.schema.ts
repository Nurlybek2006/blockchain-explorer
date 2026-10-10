import {
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const prices = pgTable(
  'prices',
  {
    assetKey: varchar('asset_key', {
      length: 128,
    }).primaryKey(),

    tokenAddress: varchar(
      'token_address',
      {
        length: 42,
      },
    ),

    coinGeckoId: varchar(
      'coingecko_id',
      {
        length: 255,
      },
    ),

    symbol: varchar('symbol', {
      length: 64,
    }).notNull(),

    usdPrice: numeric('usd_price', {
      precision: 38,
      scale: 18,
    }).notNull(),

    change24hPercent: numeric(
      'change_24h_percent',
      {
        precision: 20,
        scale: 8,
      },
    ),

    marketCapUsd: numeric(
      'market_cap_usd',
      {
        precision: 38,
        scale: 2,
      },
    ),

    fetchedAt: timestamp('fetched_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index('prices_fetched_at_idx')
      .on(table.fetchedAt),
  ],
);

export const priceSnapshots = pgTable(
  'price_snapshots',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    assetKey: varchar('asset_key', {
      length: 128,
    }).notNull(),

    usdPrice: numeric('usd_price', {
      precision: 38,
      scale: 18,
    }).notNull(),

    recordedAt: timestamp(
      'recorded_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index(
      'price_snapshots_asset_time_idx',
    ).on(
      table.assetKey,
      table.recordedAt,
    ),
  ],
);
// CoinGecko-дан алынған current price және price history-ді сақтайды.