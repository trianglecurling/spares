ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "public_signups" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_public_signups" ON "volunteer_programs" ("public_signups");
--> statement-breakpoint
ALTER TABLE "volunteer_signups" ADD COLUMN IF NOT EXISTS "guest_email" text;
--> statement-breakpoint
ALTER TABLE "volunteer_signups" ADD COLUMN IF NOT EXISTS "access_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_signups_access_token_unique" ON "volunteer_signups" ("access_token");
