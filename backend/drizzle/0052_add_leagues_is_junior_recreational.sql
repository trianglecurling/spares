ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "is_junior_recreational" integer DEFAULT 0 NOT NULL;
