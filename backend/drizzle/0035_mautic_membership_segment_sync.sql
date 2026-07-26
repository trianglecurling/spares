ALTER TABLE "curling_seasons" ADD COLUMN IF NOT EXISTS "mautic_segment_id" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mautic_membership_sync_status" (
	"id" integer PRIMARY KEY NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" text,
	"last_run_summary" text,
	"last_run_triggered_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mautic_membership_sync_status" ADD CONSTRAINT "mautic_membership_sync_status_last_run_triggered_by_member_id_members_id_fk" FOREIGN KEY ("last_run_triggered_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
