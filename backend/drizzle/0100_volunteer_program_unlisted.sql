ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "unlisted" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "share_token" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_programs_share_token_unique" ON "volunteer_programs" ("share_token");
