CREATE TABLE IF NOT EXISTS "event_transfer_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_transfer_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "transfer_group_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_transfer_group_id_event_transfer_groups_id_fk" FOREIGN KEY ("transfer_group_id") REFERENCES "public"."event_transfer_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_transfer_group_id" ON "events" ("transfer_group_id");
--> statement-breakpoint
ALTER TABLE "event_registration_fields" ADD COLUMN IF NOT EXISTS "field_key" text;
--> statement-breakpoint
UPDATE "event_registration_fields"
SET "field_key" = gen_random_uuid()::text
WHERE "field_key" IS NULL OR trim("field_key") = '';
--> statement-breakpoint
ALTER TABLE "event_registration_fields" ALTER COLUMN "field_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_registration_fields_event_field_key_unique_pg" ON "event_registration_fields" ("event_id","field_key");
