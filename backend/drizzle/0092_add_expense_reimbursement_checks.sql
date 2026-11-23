CREATE TABLE IF NOT EXISTS "expense_reimbursement_checks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_reimbursement_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payee_member_id" integer,
	"payee_name" text NOT NULL,
	"payee_email" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"issued_by_member_id" integer,
	"issued_by_name" text NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_reimbursement_checks" ADD CONSTRAINT "expense_reimbursement_checks_payee_member_id_members_id_fk" FOREIGN KEY ("payee_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_reimbursement_checks" ADD CONSTRAINT "expense_reimbursement_checks_issued_by_member_id_members_id_fk" FOREIGN KEY ("issued_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reimbursement_checks_payee_member_id" ON "expense_reimbursement_checks" ("payee_member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reimbursement_checks_issued_at" ON "expense_reimbursement_checks" ("issued_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_reimbursement_check_reports" (
	"check_id" integer NOT NULL,
	"report_id" integer NOT NULL,
	CONSTRAINT "expense_reimbursement_check_reports_check_id_report_id_pk" PRIMARY KEY("check_id","report_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_reimbursement_check_reports" ADD CONSTRAINT "expense_reimbursement_check_reports_check_id_expense_reimbursement_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."expense_reimbursement_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense_reimbursement_check_reports" ADD CONSTRAINT "expense_reimbursement_check_reports_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_reimbursement_check_reports_report_unique" ON "expense_reimbursement_check_reports" ("report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reimbursement_check_reports_check_id" ON "expense_reimbursement_check_reports" ("check_id");
