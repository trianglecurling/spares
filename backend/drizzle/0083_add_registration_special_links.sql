CREATE TABLE IF NOT EXISTS "registration_special_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_special_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"registrant_email" text NOT NULL,
	"allow_league_registration" integer DEFAULT 0 NOT NULL,
	"allowed_league_ids" jsonb,
	"used" integer DEFAULT 0 NOT NULL,
	"invalidated" integer DEFAULT 0 NOT NULL,
	"created_by_member_id" integer,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_special_links_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "registration_special_links_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE restrict ON UPDATE no action,
	CONSTRAINT "registration_special_links_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registration_special_links_token_unique_pg" ON "registration_special_links" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registration_special_links_session_id" ON "registration_special_links" ("session_id");
--> statement-breakpoint
ALTER TABLE "curling_registrations" ADD COLUMN IF NOT EXISTS "special_link_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_curling_registrations_special_link_id" ON "curling_registrations" ("special_link_id");
