ALTER TABLE "event_registrations" ADD COLUMN IF NOT EXISTS "access_token" text;
--> statement-breakpoint
UPDATE "event_registrations" SET "access_token" = gen_random_uuid()::text WHERE "access_token" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_registrations_access_token_unique" ON "event_registrations" ("access_token");
