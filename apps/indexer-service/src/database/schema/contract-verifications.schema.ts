import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const contractVerifications =
  pgTable(
    'contract_verifications',
    {
      contractAddress: varchar(
        'contract_address',
        {
          length: 42,
        },
      ).primaryKey(),

      status: varchar('status', { length: 16, enum: ['verified', 'unverified', 'pending', 'unsupported', 'failed'] }).notNull().default('verified'),
      discoveredBlock: bigint('discovered_block', { mode: 'bigint' }),
      discoveredBlockHash: varchar('discovered_block_hash', { length: 66 }),
      lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
      attempts: integer('attempts').notNull().default(0),
      lastError: varchar('last_error', { length: 255 }),

      contractName: varchar(
        'contract_name',
        {
          length: 255,
        },
      ),

      compilerVersion: varchar(
        'compiler_version',
        {
          length: 100,
        },
      ),

      optimizationUsed: boolean(
        'optimization_used',
      ),

      optimizationRuns: integer(
        'optimization_runs',
      ),

      sourceCode: text('source_code'),

      abi: jsonb('abi'),

      constructorArguments: text(
        'constructor_arguments',
      ),

      verificationSource: varchar(
        'verification_source',
        {
          length: 32,
        },
      )
        .notNull()
        .default('etherscan'),

      verifiedAt: timestamp(
        'verified_at',
        {
          withTimezone: true,
        },
      )
        .defaultNow(),
    },
  );
//   Etherscan API-дан алынған verified smart contract source code пен ABI-ды сақтайды.
