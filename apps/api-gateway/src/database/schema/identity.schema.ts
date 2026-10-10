import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),

  email: varchar('email', {
    length: 320,
  })
    .notNull()
    .unique(),

  passwordHash: text('password_hash').notNull(),

  role: varchar('role', {
    length: 32,
  })
    .notNull()
    .default('user'),

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

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, {
      onDelete: 'cascade',
    }),

  tokenHash: text('token_hash').notNull(),

  expiresAt: timestamp('expires_at', {
    withTimezone: true,
  }).notNull(),

  revokedAt: timestamp('revoked_at', {
    withTimezone: true,
  }),

  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});