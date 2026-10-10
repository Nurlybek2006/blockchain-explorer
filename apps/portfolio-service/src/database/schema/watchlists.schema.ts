import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const watchlists = pgTable(
  'watchlists',
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
      .default('Watchlist'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index('watchlists_user_idx')
      .on(table.userId),
  ],
);

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    watchlistId: uuid('watchlist_id')
      .notNull()
      .references(
        () => watchlists.id,
        {
          onDelete: 'cascade',
        },
      ),

    itemType: varchar('item_type', {
      length: 20,
    }).notNull(),

    address: varchar('address', {
      length: 42,
    }).notNull(),

    label: varchar('label', {
      length: 100,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    uniqueIndex(
      'watchlist_items_unique_idx',
    ).on(
      table.watchlistId,
      table.itemType,
      table.address,
    ),
  ],
);
// User Ethereum address немесе token-дарды watchlist-ке қосып бақылай алады.