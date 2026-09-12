CREATE TABLE IF NOT EXISTS "roster_confirmation_email_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roster_confirmation_email_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"actor_member_id" integer NOT NULL,
	"status" text NOT NULL,
	"unsent_only" integer DEFAULT 0 NOT NULL,
	"frontend_base_url" text,
	"member_ids_json" jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"errors_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "roster_confirmation_email_jobs_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "roster_confirmation_email_jobs_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roster_confirmation_email_jobs_session_id" ON "roster_confirmation_email_jobs" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_roster_confirmation_email_jobs_status" ON "roster_confirmation_email_jobs" ("status");
