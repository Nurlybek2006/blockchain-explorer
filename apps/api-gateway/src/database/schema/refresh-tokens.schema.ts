import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.schema.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(
        () => users.id,
        {
          onDelete: 'cascade',
        },
      ),

    familyId: uuid('family_id')
      .notNull()
      .defaultRandom(),

    tokenHash: text('token_hash')
      .notNull(),

    userAgent: text('user_agent'),

    ipAddress: varchar('ip_address', {
      length: 45,
    }),

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
  },

  (table) => [
    uniqueIndex('refresh_tokens_token_hash_uq')
      .on(table.tokenHash),

    index('refresh_tokens_user_id_idx')
      .on(table.userId),

    index('refresh_tokens_expires_at_idx')
      .on(table.expiresAt),

    index('refresh_tokens_family_id_idx')
      .on(table.familyId),
  ],
);