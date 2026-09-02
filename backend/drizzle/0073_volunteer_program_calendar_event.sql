ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "calendar_event_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_programs" ADD CONSTRAINT "volunteer_programs_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_programs_calendar_event_id_unique" ON "volunteer_programs" ("calendar_event_id");
