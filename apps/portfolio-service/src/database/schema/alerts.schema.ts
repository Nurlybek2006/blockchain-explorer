import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    userId: uuid('user_id')
      .notNull(),

    type: varchar('type', {
      length: 32,
    }).notNull(),

    enabled: boolean('enabled')
      .notNull()
      .default(true),

    walletAddress: varchar(
      'wallet_address',
      {
        length: 42,
      },
    ),

    tokenAddress: varchar(
      'token_address',
      {
        length: 42,
      },
    ),

    thresholdUsd: numeric(
      'threshold_usd',
      {
        precision: 38,
        scale: 2,
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
    index('alerts_user_idx')
      .on(table.userId),

    index('alerts_type_idx')
      .on(table.type),
  ],
);

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    alertId: uuid('alert_id')
      .notNull()
      .references(
        () => alerts.id,
        {
          onDelete: 'cascade',
        },
      ),

    title: varchar('title', {
      length: 255,
    }).notNull(),

    message: text('message'),

    payload: jsonb('payload'),

    triggeredAt: timestamp(
      'triggered_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    readAt: timestamp('read_at', {
      withTimezone: true,
    }),
  },

  (table) => [
    index('alert_events_alert_idx')
      .on(table.alertId),

    index(
      'alert_events_triggered_idx',
    ).on(table.triggeredAt),
  ],
);
// Whale transaction, price threshold және wallet activity alert ережелері мен олардың тарихын сақтайды.