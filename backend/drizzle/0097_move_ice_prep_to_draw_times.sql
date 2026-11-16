ALTER TABLE "league_draw_times" ADD COLUMN IF NOT EXISTS "ice_prep_minutes" integer DEFAULT 0 NOT NULL;

UPDATE "league_draw_times" AS dt
SET "ice_prep_minutes" = l."ice_prep_minutes"
FROM "leagues" AS l
WHERE dt."league_id" = l."id";

ALTER TABLE "leagues" DROP COLUMN IF EXISTS "ice_prep_minutes";
