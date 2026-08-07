ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "published" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "volunteer_programs" SET "published" = 1 WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_published" ON "volunteer_programs" ("published");
