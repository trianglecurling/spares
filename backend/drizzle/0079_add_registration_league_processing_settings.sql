CREATE TABLE IF NOT EXISTS "registration_league_processing_settings" (
	"scope" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "registration_league_processing_settings" ("scope", "enabled")
VALUES ('singleton', 0)
ON CONFLICT ("scope") DO NOTHING;
