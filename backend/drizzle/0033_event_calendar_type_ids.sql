-- Multi-select event types + restore tournament_format for bonspiel fours/doubles.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "calendar_type_ids" text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "tournament_format" text;
--> statement-breakpoint
UPDATE "events"
SET
  "calendar_type_ids" = '["bonspiel"]',
  "tournament_format" = 'doubles'
WHERE "calendar_type_id" = 'bonspiel-doubles';
--> statement-breakpoint
UPDATE "events"
SET
  "calendar_type_ids" = '["bonspiel"]',
  "tournament_format" = 'fours'
WHERE "calendar_type_id" IN ('bonspiel-fours', 'bonspiel');
--> statement-breakpoint
UPDATE "events"
SET
  "calendar_type_ids" = '["no-experience-necessary"]',
  "tournament_format" = NULL
WHERE "calendar_type_id" IN ('learn-to-curl', 'learn_to_curl', 'clinic');
--> statement-breakpoint
UPDATE "events"
SET
  "calendar_type_ids" = '["juniors"]',
  "tournament_format" = NULL
WHERE "calendar_type_id" = 'juniors';
--> statement-breakpoint
UPDATE "events"
SET
  "calendar_type_ids" = '[]',
  "tournament_format" = NULL
WHERE "calendar_type_id" IS NULL
   OR "calendar_type_id" IN ('other', 'social', 'maintenance');
--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN IF EXISTS "calendar_type_id";
