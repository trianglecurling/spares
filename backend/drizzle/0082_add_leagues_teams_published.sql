ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "teams_published" integer DEFAULT 1 NOT NULL;
