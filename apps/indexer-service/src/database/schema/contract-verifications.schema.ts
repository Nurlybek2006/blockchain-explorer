import {
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
        .notNull()
        .defaultNow(),
    },
  );
//   Etherscan API-дан алынған verified smart contract source code пен ABI-ды сақтайды.