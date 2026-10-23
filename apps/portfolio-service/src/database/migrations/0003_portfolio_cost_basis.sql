CREATE TABLE "portfolio_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"asset_key" varchar(128) NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"decimals" integer NOT NULL,
	"side" varchar(20) NOT NULL,
	"quantity_raw" numeric(78, 0) NOT NULL,
	"unit_price_usd" numeric(78, 18),
	"fee_usd" numeric(78, 18) DEFAULT '0' NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"transaction_hash" varchar(66),
	"activity_id" varchar(200),
	CONSTRAINT "portfolio_trades_values_check" CHECK ("portfolio_trades"."quantity_raw" > 0 AND "portfolio_trades"."quantity_raw" <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 AND "portfolio_trades"."decimals" BETWEEN 0 AND 255 AND "portfolio_trades"."fee_usd" >= 0 AND ("portfolio_trades"."unit_price_usd" IS NULL OR "portfolio_trades"."unit_price_usd" >= 0)),
	CONSTRAINT "portfolio_trades_side_check" CHECK (("portfolio_trades"."side" IN ('buy','sell','transfer_in') AND "portfolio_trades"."unit_price_usd" IS NOT NULL) OR ("portfolio_trades"."side" IN ('transfer_out','fee') AND "portfolio_trades"."unit_price_usd" IS NULL AND "portfolio_trades"."fee_usd" = 0))
);
--> statement-breakpoint
ALTER TABLE "portfolio_trades" ADD CONSTRAINT "portfolio_trades_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_trades_client_uq" ON "portfolio_trades" USING btree ("portfolio_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_trades_activity_uq" ON "portfolio_trades" USING btree ("portfolio_id","activity_id") WHERE "portfolio_trades"."activity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "portfolio_trades_order_idx" ON "portfolio_trades" USING btree ("portfolio_id","occurred_at","sequence");