import {
  bigint,
  boolean,
  numeric,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';

import { blocks } from './blocks.schema.js';
import { transactions } from './transactions.schema.js';

export const receipts = pgTable(
  'receipts',
  {
    transactionHash: varchar(
      'transaction_hash',
      {
        length: 66,
      },
    )
      .primaryKey()
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

    status: boolean('status')
      .notNull(),

    contractAddress: varchar(
      'contract_address',
      {
        length: 42,
      },
    ),

    cumulativeGasUsed: numeric(
      'cumulative_gas_used',
      {
        precision: 78,
        scale: 0,
      },
    ).notNull(),

    gasUsed: numeric('gas_used', {
      precision: 78,
      scale: 0,
    }).notNull(),

    effectiveGasPrice: numeric(
      'effective_gas_price',
      {
        precision: 78,
        scale: 0,
      },
    ),

    logsBloom: text('logs_bloom'),
  },
);
// Transaction орындалғаннан кейінгі нәтиже: success/fail, gas usage және contract creation мәліметтерін сақтайды.