import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    email: varchar('email', {
      length: 320,
    })
      .notNull()
      .unique(),

    passwordHash: text('password_hash')
      .notNull(),

    displayName: varchar('display_name', {
      length: 100,
    }),

    role: varchar('role', {
      length: 32,
    })
      .notNull()
      .default('user'),

    isActive: boolean('is_active')
      .notNull()
      .default(true),

    emailVerifiedAt: timestamp(
      'email_verified_at',
      {
        withTimezone: true,
      },
    ),

    lastLoginAt: timestamp(
      'last_login_at',
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
    index('users_role_idx')
      .on(table.role),

    index('users_created_at_idx')
      .on(table.createdAt),
  ],
);