CREATE TABLE "transaction_trace_requests" (
	"transaction_hash" varchar(66) PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_verifications" ALTER COLUMN "verified_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "code_checked_block" bigint;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "code_check_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "code_check_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "status" varchar(16) DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "discovered_block" bigint;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "discovered_block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_verifications" ADD COLUMN "last_error" varchar(255);--> statement-breakpoint
ALTER TABLE "transaction_trace_requests" ADD CONSTRAINT "transaction_trace_requests_transaction_hash_transactions_hash_fk" FOREIGN KEY ("transaction_hash") REFERENCES "public"."transactions"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_trace_requests" ADD CONSTRAINT "transaction_trace_requests_block_number_blocks_number_fk" FOREIGN KEY ("block_number") REFERENCES "public"."blocks"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trace_requests_dispatch_idx" ON "transaction_trace_requests" USING btree ("status","available_at");