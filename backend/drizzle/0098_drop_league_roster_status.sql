-- A league_roster row is league membership. Non-active rows are kept only when the
-- member is still on a team in that league; otherwise they are deleted.
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'league_roster' AND column_name = 'status'
 ) THEN
  DELETE FROM "league_roster" AS lr
  WHERE lr."status" <> 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM "team_members" AS tm
      JOIN "league_teams" AS lt ON lt."id" = tm."team_id"
      WHERE lt."league_id" = lr."league_id" AND tm."member_id" = lr."member_id"
    );
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "league_roster" DROP COLUMN IF EXISTS "status";
