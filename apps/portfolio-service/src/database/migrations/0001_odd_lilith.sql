CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"payload" jsonb,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"wallet_address" varchar(42),
	"token_address" varchar(42),
	"threshold_usd" numeric(38, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"asset_key" varchar(128) NOT NULL,
	"asset_type" varchar(20) NOT NULL,
	"token_address" varchar(42),
	"symbol" varchar(64) NOT NULL,
	"name" varchar(255),
	"decimals" smallint NOT NULL,
	"balance_raw" numeric(78, 0) DEFAULT '0' NOT NULL,
	"last_updated_block" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "processed_events" (
	"event_id" varchar(64) PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"total_value_usd" numeric(38, 2) NOT NULL,
	"total_value_eth" numeric(38, 18),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_key" varchar(128) NOT NULL,
	"usd_price" numeric(38, 18) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"asset_key" varchar(128) PRIMARY KEY NOT NULL,
	"token_address" varchar(42),
	"coingecko_id" varchar(255),
	"symbol" varchar(64) NOT NULL,
	"usd_price" numeric(38, 18) NOT NULL,
	"change_24h_percent" numeric(20, 8),
	"market_cap_usd" numeric(38, 2),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"address" varchar(42) NOT NULL,
	"label" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) DEFAULT 'Watchlist' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "chain_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_alert_idx" ON "alert_events" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alert_events_triggered_idx" ON "alert_events" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX "alerts_user_idx" ON "alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_type_idx" ON "alerts" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_asset_uq" ON "holdings" USING btree ("portfolio_id","asset_key");--> statement-breakpoint
CREATE INDEX "holdings_token_idx" ON "holdings" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "portfolio_outbox_status_idx" ON "outbox_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "portfolio_outbox_available_idx" ON "outbox_events" USING btree ("available_at");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_portfolio_time_idx" ON "portfolio_snapshots" USING btree ("portfolio_id","recorded_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_asset_time_idx" ON "price_snapshots" USING btree ("asset_key","recorded_at");--> statement-breakpoint
CREATE INDEX "prices_fetched_at_idx" ON "prices" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_unique_idx" ON "watchlist_items" USING btree ("watchlist_id","item_type","address");--> statement-breakpoint
CREATE INDEX "watchlists_user_idx" ON "watchlists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_user_wallet_chain_uq" ON "portfolios" USING btree ("user_id","wallet_address","chain_id");--> statement-breakpoint
CREATE INDEX "portfolios_user_id_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolios_wallet_idx" ON "portfolios" USING btree ("wallet_address");