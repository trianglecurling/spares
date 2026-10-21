ALTER TABLE "expense_reimbursement_checks" ADD COLUMN IF NOT EXISTS "check_number" text;
--> statement-breakpoint
UPDATE "expense_reimbursement_checks" SET "check_number" = '' WHERE "check_number" IS NULL;
--> statement-breakpoint
ALTER TABLE "expense_reimbursement_checks" ALTER COLUMN "check_number" SET NOT NULL;
