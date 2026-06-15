ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "public_notes" text;
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "team_formation" text DEFAULT 'coordinator' NOT NULL;
