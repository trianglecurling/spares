CREATE TABLE IF NOT EXISTS "expense_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"member_id" integer,
	"submitter_name" text NOT NULL,
	"submitter_email" text NOT NULL,
	"submitter_phone" text,
	"mailing_address" text,
	"access_token" text,
	"committee_id" integer,
	"committee_name" text,
	"committee_custom" text,
	"purpose" text,
	"requested_amount_minor" integer NOT NULL,
	"requested_currency" text DEFAULT 'usd' NOT NULL,
	"amount_justification" text,
	"used_club_credit_card" integer,
	"comments" text,
	"activity_date" date,
	"from_kind" text,
	"from_other" text,
	"to_kind" text,
	"to_other" text,
	"round_trip_miles" double precision,
	"trip_purpose" text,
	"trip_purpose_other" text,
	"staff_notes" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_receipts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_id" integer NOT NULL,
	"name" text NOT NULL,
	"receipt_date" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"currency_other" text,
	"includes_durable_good" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_committee_id_governance_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."governance_committees"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reports_member_id" ON "expense_reports" ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reports_submitter_email" ON "expense_reports" ("submitter_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reports_status" ON "expense_reports" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_reports_submitted_at" ON "expense_reports" ("submitted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_reports_access_token_unique" ON "expense_reports" ("access_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_receipts_report_id" ON "expense_receipts" ("report_id");
