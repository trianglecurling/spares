ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "point_of_contact" text;
--> statement-breakpoint
UPDATE "events" SET "point_of_contact" = 'spiels@trianglecurling.com' WHERE "point_of_contact" IS NULL;
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "point_of_contact" SET NOT NULL;
