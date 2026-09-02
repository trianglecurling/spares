ALTER TABLE "volunteer_shifts" ADD COLUMN IF NOT EXISTS "source_calendar_event_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_source_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("source_calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shifts_source_calendar_event_id" ON "volunteer_shifts" ("source_calendar_event_id");
