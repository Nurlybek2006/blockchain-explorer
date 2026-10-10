import {
  integer,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const syncState = pgTable(
  'sync_state',
  {
    chainId: integer('chain_id')
      .primaryKey(),

    networkName: varchar(
      'network_name',
      {
        length: 64,
      },
    ).notNull(),

    lastScannedBlock: numeric(
      'last_scanned_block',
      {
        precision: 78,
        scale: 0,
      },
    )
      .notNull()
      .default('0'),

    lastFinalizedBlock: numeric(
      'last_finalized_block',
      {
        precision: 78,
        scale: 0,
      },
    )
      .notNull()
      .default('0'),

    lastBlockHash: varchar(
      'last_block_hash',
      {
        length: 66,
      },
    ),

    status: varchar('status', {
      length: 32,
    })
      .notNull()
      .default('idle'),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
);
// Indexer қай block-қа дейін жеткенін сақтайды. Server restart болса, indexing басынан емес, соңғы block-тан жалғасады.