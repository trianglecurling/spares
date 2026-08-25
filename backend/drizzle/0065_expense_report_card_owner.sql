ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "club_credit_card_owner_member_id" integer;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "club_credit_card_owner_name" text;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_club_credit_card_owner_member_id_members_id_fk" FOREIGN KEY ("club_credit_card_owner_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "expense_reports"
SET
  "club_credit_card_owner_name" = "submitter_name",
  "club_credit_card_owner_member_id" = "member_id"
WHERE "used_club_credit_card" = 1
  AND ("club_credit_card_owner_name" IS NULL OR btrim("club_credit_card_owner_name") = '');
