ALTER TABLE "volunteer_credentials" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_credentials_archived_at" ON "volunteer_credentials" ("archived_at");
