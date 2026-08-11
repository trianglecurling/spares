ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "slug" text;
--> statement-breakpoint
UPDATE "volunteer_programs" SET "slug" = 'program-' || "id"::text WHERE "slug" IS NULL OR trim("slug") = '';
--> statement-breakpoint
ALTER TABLE "volunteer_programs" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_programs_slug_unique" ON "volunteer_programs" ("slug");
