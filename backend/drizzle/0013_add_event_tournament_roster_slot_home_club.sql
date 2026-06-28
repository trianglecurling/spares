ALTER TABLE "event_tournament_roster_slots" ADD COLUMN IF NOT EXISTS "home_club" text;--> statement-breakpoint
UPDATE "event_tournament_roster_slots" AS s
SET "home_club" = t."home_club"
FROM "event_tournament_teams" AS t
WHERE s."team_id" = t."id"
  AND (s."home_club" IS NULL OR s."home_club" = '')
  AND t."home_club" IS NOT NULL
  AND t."home_club" <> '';
