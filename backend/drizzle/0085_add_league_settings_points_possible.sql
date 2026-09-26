ALTER TABLE "league_settings" ADD COLUMN IF NOT EXISTS "points_possible_per_game" integer;
--> statement-breakpoint
ALTER TABLE "league_settings" ADD COLUMN IF NOT EXISTS "rank_by_points_percentage" integer DEFAULT 0 NOT NULL;
