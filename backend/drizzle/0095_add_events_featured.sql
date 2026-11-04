ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "featured" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "featured_sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_featured" ON "events" ("featured");
