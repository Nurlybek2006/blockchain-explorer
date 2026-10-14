import {
  bigint,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { blocks } from './blocks.schema.js';
import { transactions } from './transactions.schema.js';

/** Durable queue intent and result state; fork removal cascades with indexed transactions. */
export const transactionTraceRequests = pgTable(
  'transaction_trace_requests',
  {
    transactionHash: varchar('transaction_hash', { length: 66 })
      .primaryKey()
      .references(() => transactions.hash, { onDelete: 'cascade' }),
    blockNumber: bigint('block_number', { mode: 'bigint' })
      .notNull()
      .references(() => blocks.number, { onDelete: 'cascade' }),
    blockHash: varchar('block_hash', { length: 66 }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: [
        'not_requested',
        'queued',
        'processing',
        'completed',
        'unsupported',
        'failed',
      ],
    })
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: varchar('last_error', { length: 255 }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('trace_requests_dispatch_idx').on(table.status, table.availableAt),
  ],
);
