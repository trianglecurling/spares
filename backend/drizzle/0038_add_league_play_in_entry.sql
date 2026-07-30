ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "play_in_spot_count" integer DEFAULT 2 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_entry_points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_entry_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"points_half" integer DEFAULT 0 NOT NULL,
	"counts_as_returning" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_entry_teams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_entry_teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_from_registration_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_entry_team_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_entry_team_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_team_id" integer NOT NULL,
	"member_id" integer,
	"pending_name" text,
	"entry_type" text DEFAULT 'add' NOT NULL,
	"replaces_league_id" integer,
	"source_registration_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "league_entry_points" ADD CONSTRAINT "league_entry_points_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_points" ADD CONSTRAINT "league_entry_points_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_points" ADD CONSTRAINT "league_entry_points_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_teams" ADD CONSTRAINT "league_entry_teams_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_teams" ADD CONSTRAINT "league_entry_teams_created_from_registration_id_curling_registrations_id_fk" FOREIGN KEY ("created_from_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_team_members" ADD CONSTRAINT "league_entry_team_members_entry_team_id_league_entry_teams_id_fk" FOREIGN KEY ("entry_team_id") REFERENCES "public"."league_entry_teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_team_members" ADD CONSTRAINT "league_entry_team_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_team_members" ADD CONSTRAINT "league_entry_team_members_replaces_league_id_leagues_id_fk" FOREIGN KEY ("replaces_league_id") REFERENCES "public"."leagues"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "league_entry_team_members" ADD CONSTRAINT "league_entry_team_members_source_registration_id_curling_registrations_id_fk" FOREIGN KEY ("source_registration_id") REFERENCES "public"."curling_registrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_points_league_id" ON "league_entry_points" ("league_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_points_member_id" ON "league_entry_points" ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_points_league_member" ON "league_entry_points" ("league_id","member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_teams_league_id" ON "league_entry_teams" ("league_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_teams_status" ON "league_entry_teams" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_team_members_entry_team_id" ON "league_entry_team_members" ("entry_team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_league_entry_team_members_member_id" ON "league_entry_team_members" ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_entry_team_members_team_member_unique" ON "league_entry_team_members" ("entry_team_id","member_id");
