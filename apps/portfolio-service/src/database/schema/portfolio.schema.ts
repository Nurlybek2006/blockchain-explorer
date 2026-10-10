import {
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const portfolios = pgTable('portfolios', {
  id: uuid('id').defaultRandom().primaryKey(),

  userId: uuid('user_id').notNull(),

  name: varchar('name', {
    length: 100,
  })
    .notNull()
    .default('Main Portfolio'),

  walletAddress: varchar('wallet_address', {
    length: 42,
  }).notNull(),

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
});