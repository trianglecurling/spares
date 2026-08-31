ALTER TABLE "volunteer_credentials" ADD COLUMN IF NOT EXISTS "system_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_credentials_system_key_unique_pg" ON "volunteer_credentials" ("system_key");
