import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { blocks } from './blocks.schema.js';

export const transactions = pgTable(
  'transactions',
  {
    hash: varchar('hash', {
      length: 66,
    }).primaryKey(),

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

    blockHash: varchar('block_hash', {
      length: 66,
    }).notNull(),

    transactionIndex: integer(
      'transaction_index',
    ).notNull(),

    fromAddress: varchar(
      'from_address',
      {
        length: 42,
      },
    ).notNull(),

    toAddress: varchar('to_address', {
      length: 42,
    }),

    nonce: numeric('nonce', {
      precision: 78,
      scale: 0,
    }).notNull(),

    value: numeric('value', {
      precision: 78,
      scale: 0,
    })
      .notNull()
      .default('0'),

    gas: numeric('gas', {
      precision: 78,
      scale: 0,
    }).notNull(),

    gasPrice: numeric('gas_price', {
      precision: 78,
      scale: 0,
    }),

    maxFeePerGas: numeric(
      'max_fee_per_gas',
      {
        precision: 78,
        scale: 0,
      },
    ),

    maxPriorityFeePerGas: numeric(
      'max_priority_fee_per_gas',
      {
        precision: 78,
        scale: 0,
      },
    ),

    type: integer('type'),

    input: text('input')
      .notNull()
      .default('0x'),

    indexedAt: timestamp('indexed_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },

  (table) => [
    index('transactions_block_number_idx')
      .on(table.blockNumber),

    index('transactions_from_address_idx')
      .on(table.fromAddress),

    index('transactions_to_address_idx')
      .on(table.toAddress),

    index('transactions_block_hash_idx')
      .on(table.blockHash),
  ],
);
// Әр Ethereum transaction-ды сақтайды. Кейін /tx/:hash, address transaction history және whale detection осы кестеге сүйенеді.