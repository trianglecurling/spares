CREATE TABLE IF NOT EXISTS "parent_org_confirmation_email_state" (
	"scope" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_queued_at" timestamp,
	"last_queued_count" integer DEFAULT 0 NOT NULL,
	"last_skipped_no_email" integer DEFAULT 0 NOT NULL,
	"last_confirm_by_date" text,
	"last_actor_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "parent_org_confirmation_email_state_last_actor_member_id_members_id_fk" FOREIGN KEY ("last_actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
INSERT INTO "parent_org_confirmation_email_state" ("scope")
VALUES ('singleton')
ON CONFLICT ("scope") DO NOTHING;
