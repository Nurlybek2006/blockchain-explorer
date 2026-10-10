import {
  bigint,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { blocks } from './blocks.schema.js';
import { transactions } from './transactions.schema.js';

export const transactionTraces =
  pgTable(
    'transaction_traces',
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

      blockNumber: bigint(
        'block_number',
        {
          mode: 'bigint',
        },
      )
        .notNull()
        .references(
          () => blocks.number,
          {
            onDelete: 'cascade',
          },
        ),

      traceAddress: varchar(
        'trace_address',
        {
          length: 128,
        },
      )
        .notNull()
        .default('root'),

      type: varchar('type', {
        length: 32,
      }).notNull(),

      callType: varchar('call_type', {
        length: 32,
      }),

      fromAddress: varchar(
        'from_address',
        {
          length: 42,
        },
      ),

      toAddress: varchar(
        'to_address',
        {
          length: 42,
        },
      ),

      value: numeric('value', {
        precision: 78,
        scale: 0,
      }),

      gas: numeric('gas', {
        precision: 78,
        scale: 0,
      }),

      gasUsed: numeric('gas_used', {
        precision: 78,
        scale: 0,
      }),

      input: text('input'),

      output: text('output'),

      error: text('error'),
    },

    (table) => [
      uniqueIndex(
        'transaction_traces_path_uq',
      ).on(
        table.transactionHash,
        table.traceAddress,
      ),

      index(
        'transaction_traces_block_idx',
      ).on(table.blockNumber),

      index(
        'transaction_traces_from_idx',
      ).on(table.fromAddress),

      index(
        'transaction_traces_to_idx',
      ).on(table.toAddress),
    ],
  );
//   debug_traceTransaction арқылы алынатын internal call/transaction мәліметтерін сақтауға дайын кесте.