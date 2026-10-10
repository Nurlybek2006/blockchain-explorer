import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { blocks } from './blocks.schema.js';
import { transactions } from './transactions.schema.js';

export const logs = pgTable(
  'logs',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    transactionHash: varchar(
      'transaction_hash',
      {
        length: 66,
      },
    )
      .notNull()
      .references(
        () => transactions.hash,
        {
          onDelete: 'cascade',
        },
      ),

    blockNumber: bigint('block_number', {
      mode: 'bigint',
    })
      .notNull()
      .references(
        () => blocks.number,
        {
          onDelete: 'cascade',
        },
      ),

    logIndex: integer('log_index')
      .notNull(),

    address: varchar('address', {
      length: 42,
    }).notNull(),

    topic0: varchar('topic0', {
      length: 66,
    }),

    topic1: varchar('topic1', {
      length: 66,
    }),

    topic2: varchar('topic2', {
      length: 66,
    }),

    topic3: varchar('topic3', {
      length: 66,
    }),

    data: text('data')
      .notNull()
      .default('0x'),

    removed: boolean('removed')
      .notNull()
      .default(false),
  },

  (table) => [
    uniqueIndex('logs_tx_log_index_uq')
      .on(
        table.transactionHash,
        table.logIndex,
      ),

    index('logs_address_idx')
      .on(table.address),

    index('logs_topic0_idx')
      .on(table.topic0),

    index('logs_block_number_idx')
      .on(table.blockNumber),
  ],
);
// Smart contract event log-тарын сақтайды. ERC-20 Transfer сияқты event-тер дәл осы log-тардан анықталады.