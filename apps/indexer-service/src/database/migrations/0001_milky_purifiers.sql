CREATE TABLE "addresses" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"is_contract" boolean DEFAULT false NOT NULL,
	"native_balance_wei" numeric(78, 0) DEFAULT '0' NOT NULL,
	"transaction_count" numeric(78, 0) DEFAULT '0' NOT NULL,
	"first_seen_block" bigint,
	"last_seen_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_verifications" (
	"contract_address" varchar(42) PRIMARY KEY NOT NULL,
	"contract_name" varchar(255),
	"compiler_version" varchar(100),
	"optimization_used" boolean,
	"optimization_runs" integer,
	"source_code" text,
	"abi" jsonb,
	"constructor_arguments" text,
	"verification_source" varchar(32) DEFAULT 'etherscan' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"topic0" varchar(66),
	"topic1" varchar(66),
	"topic2" varchar(66),
	"topic3" varchar(66),
	"data" text DEFAULT '0x' NOT NULL,
	"removed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(100),
	"aggregate_id" varchar(128),
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"transaction_hash" varchar(66) PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"status" boolean NOT NULL,
	"contract_address" varchar(42),
	"cumulative_gas_used" numeric(78, 0) NOT NULL,
	"gas_used" numeric(78, 0) NOT NULL,
	"effective_gas_price" numeric(78, 0),
	"logs_bloom" text
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"network_name" varchar(64) NOT NULL,
	"last_scanned_block" numeric(78, 0) DEFAULT '0' NOT NULL,
	"last_finalized_block" numeric(78, 0) DEFAULT '0' NOT NULL,
	"last_block_hash" varchar(66),
	"status" varchar(32) DEFAULT 'idle' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"transaction_index" integer NOT NULL,
	"log_index" integer NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"symbol" varchar(64),
	"decimals" smallint,
	"total_supply" numeric(78, 0),
	"first_seen_block" bigint,
	"last_updated_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"trace_address" varchar(128) DEFAULT 'root' NOT NULL,
	"type" varchar(32) NOT NULL,
	"call_type" varchar(32),
	"from_address" varchar(42),
	"to_address" varchar(42),
	"value" numeric(78, 0),
	"gas" numeric(78, 0),
	"gas_used" numeric(78, 0),
	"input" text,
	"output" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"hash" varchar(66) PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"transaction_index" integer NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42),
	"nonce" numeric(78, 0) NOT NULL,
	"value" numeric(78, 0) DEFAULT '0' NOT NULL,
	"gas" numeric(78, 0) NOT NULL,
	"gas_price" numeric(78, 0),
	"max_fee_per_gas" numeric(78, 0),
	"max_priority_fee_per_gas" numeric(78, 0),
	"type" integer,
	"input" text DEFAULT '0x' NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "size" integer;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "transactions_root" varchar(66);--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "state_root" varchar(66);--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "receipts_root" varchar(66);--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "extra_data" text;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "public"."transactions"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "public"."transactions"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD CONSTRAINT "token_transfers_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "public"."transactions"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD CONSTRAINT "token_transfers_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD CONSTRAINT "token_transfers_token_address_tokens_address_fk" FOREIGN KEY ("token_address") REFERENCES "public"."tokens"("address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_traces" ADD CONSTRAINT "transaction_traces_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "public"."transactions"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_traces" ADD CONSTRAINT "transaction_traces_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_last_seen_idx" ON "addresses" USING btree ("last_seen_block");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_chain_block_uq" ON "checkpoints" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE INDEX "checkpoints_created_at_idx" ON "checkpoints" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "logs_tx_log_index_uq" ON "logs" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "logs_address_idx" ON "logs" USING btree ("address");--> statement-breakpoint
CREATE INDEX "logs_topic0_idx" ON "logs" USING btree ("topic0");--> statement-breakpoint
CREATE INDEX "logs_block_number_idx" ON "logs" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbox_available_at_idx" ON "outbox_events" USING btree ("available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "token_transfers_tx_log_uq" ON "token_transfers" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "token_transfers_token_idx" ON "token_transfers" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "token_transfers_from_idx" ON "token_transfers" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "token_transfers_to_idx" ON "token_transfers" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "token_transfers_block_idx" ON "token_transfers" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "tokens_symbol_idx" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_traces_path_uq" ON "transaction_traces" USING btree ("transaction_hash","trace_address");--> statement-breakpoint
CREATE INDEX "transaction_traces_block_idx" ON "transaction_traces" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "transaction_traces_from_idx" ON "transaction_traces" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "transaction_traces_to_idx" ON "transaction_traces" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "transactions_block_number_idx" ON "transactions" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "transactions_from_address_idx" ON "transactions" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "transactions_to_address_idx" ON "transactions" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "transactions_block_hash_idx" ON "transactions" USING btree ("block_hash");--> statement-breakpoint
CREATE INDEX "blocks_timestamp_idx" ON "blocks" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "blocks_miner_idx" ON "blocks" USING btree ("miner");