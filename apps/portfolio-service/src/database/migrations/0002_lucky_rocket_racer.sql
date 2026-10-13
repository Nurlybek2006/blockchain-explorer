ALTER TABLE "alerts" ALTER COLUMN "threshold_usd" SET DATA TYPE numeric(78, 18);--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "event_key" varchar(255);--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "last_condition_met" boolean;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "last_evaluated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_alert_event_key_uq" ON "alert_events" USING btree ("alert_id","event_key");