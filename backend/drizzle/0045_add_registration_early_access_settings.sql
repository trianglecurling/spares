CREATE TABLE IF NOT EXISTS "registration_early_access_settings" (
	"scope" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"enabled" integer DEFAULT 0 NOT NULL,
	"password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "registration_early_access_settings" ("scope", "enabled", "password_hash")
VALUES ('singleton', 0, NULL)
ON CONFLICT ("scope") DO NOTHING;
