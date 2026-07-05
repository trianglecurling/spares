ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_archived_at" ON "events" USING btree ("archived_at");
