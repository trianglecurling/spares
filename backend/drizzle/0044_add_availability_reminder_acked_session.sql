ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "availability_reminder_acked_session_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "members" ADD CONSTRAINT "members_availability_reminder_acked_session_id_curling_sessions_id_fk" FOREIGN KEY ("availability_reminder_acked_session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
