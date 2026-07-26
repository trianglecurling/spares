ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "contact_first_name_label" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "contact_last_name_label" text;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "contact_email_label" text;
