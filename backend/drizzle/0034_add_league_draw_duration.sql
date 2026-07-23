ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "draw_duration_minutes" integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
UPDATE "leagues" SET "draw_duration_minutes" = 90 WHERE "format" = 'doubles' AND "draw_duration_minutes" = 120;
