ALTER TABLE "event_tournament_teams" ADD COLUMN IF NOT EXISTS "registration_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "event_tournament_teams"
    ADD CONSTRAINT "event_tournament_teams_registration_id_event_registrations_id_fk"
    FOREIGN KEY ("registration_id") REFERENCES "public"."event_registrations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_tournament_teams_registration_id_unique"
  ON "event_tournament_teams" ("registration_id")
  WHERE "registration_id" IS NOT NULL;
