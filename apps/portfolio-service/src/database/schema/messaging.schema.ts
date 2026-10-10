import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: varchar('event_id', {
      length: 64,
    }).primaryKey(),

    eventType: varchar('event_type', {
      length: 100,
    }).notNull(),

    processedAt: timestamp(
      'processed_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    eventType: varchar('event_type', {
      length: 100,
    }).notNull(),

    aggregateType: varchar(
      'aggregate_type',
      {
        length: 100,
      },
    ),

    aggregateId: varchar(
      'aggregate_id',
      {
        length: 128,
      },
    ),

    payload: jsonb('payload')
      .notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    attempts: integer('attempts')
      .notNull()
      .default(0),

    availableAt: timestamp(
      'available_at',
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    publishedAt: timestamp(
      'published_at',
      {
        withTimezone: true,
      },
    ),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index(
      'portfolio_outbox_status_idx',
    ).on(table.status),

    index(
      'portfolio_outbox_available_idx',
    ).on(table.availableAt),
  ],
);
// RabbitMQ message-терін duplicate өңдеуден қорғайды және Portfolio Service өзі шығаратын event-терді сенімді жариялауға мүмкіндік береді.