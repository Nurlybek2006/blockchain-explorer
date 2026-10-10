import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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
    index('outbox_status_idx')
      .on(table.status),

    index('outbox_available_at_idx')
      .on(table.availableAt),
  ],
);

// Кейін PostgreSQL transaction мен RabbitMQ event арасында data жоғалмауы үшін Transactional Outbox Pattern қолданамыз.
// Бұл professional microservice жобаларында өте пайдалы нәрсе.