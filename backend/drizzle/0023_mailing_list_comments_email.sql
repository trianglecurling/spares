ALTER TABLE "mailing_lists" DROP CONSTRAINT IF EXISTS "mailing_lists_owner_member_id_members_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_mailing_lists_owner_member_id";
--> statement-breakpoint
ALTER TABLE "mailing_lists" DROP COLUMN IF EXISTS "owner_member_id";
--> statement-breakpoint
ALTER TABLE "mailing_lists" ADD COLUMN IF NOT EXISTS "comments_recipient_email" text;
