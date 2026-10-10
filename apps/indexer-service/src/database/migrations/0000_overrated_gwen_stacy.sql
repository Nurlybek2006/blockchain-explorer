CREATE TABLE "blocks" (
	"number" bigint PRIMARY KEY NOT NULL,
	"hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"miner" varchar(42),
	"timestamp" timestamp with time zone NOT NULL,
	"gas_limit" numeric(78, 0) NOT NULL,
	"gas_used" numeric(78, 0) NOT NULL,
	"base_fee_per_gas" numeric(78, 0),
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_hash_unique" UNIQUE("hash")
);
