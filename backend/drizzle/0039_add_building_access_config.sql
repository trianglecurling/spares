CREATE TABLE IF NOT EXISTS "building_access_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"access_code" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT 'markdown' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_by_member_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "building_access_config" ADD CONSTRAINT "building_access_config_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "building_access_config" ("id", "access_code", "content_type", "content")
VALUES (1, '', 'markdown', '')
ON CONFLICT ("id") DO NOTHING;
