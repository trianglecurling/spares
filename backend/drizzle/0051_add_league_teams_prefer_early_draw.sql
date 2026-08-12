ALTER TABLE "league_teams" ADD COLUMN IF NOT EXISTS "prefer_early_draw" integer DEFAULT 0 NOT NULL;
