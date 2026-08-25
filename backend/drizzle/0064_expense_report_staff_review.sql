UPDATE "expense_reports" SET "status" = 'pending_review' WHERE "status" = 'new';
--> statement-breakpoint
ALTER TABLE "expense_reports" ALTER COLUMN "status" SET DEFAULT 'pending_review';
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "status_changed_by_member_id" integer;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "status_changed_by_name" text;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "last_updated_by_member_id" integer;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD COLUMN IF NOT EXISTS "last_updated_by_name" text;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_status_changed_by_member_id_members_id_fk" FOREIGN KEY ("status_changed_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_last_updated_by_member_id_members_id_fk" FOREIGN KEY ("last_updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_report_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_report_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_id" integer NOT NULL,
	"author_member_id" integer,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_report_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_report_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"report_id" integer NOT NULL,
	"actor_member_id" integer,
	"actor_name" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_report_notes" ADD CONSTRAINT "expense_report_notes_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_report_notes" ADD CONSTRAINT "expense_report_notes_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_report_changes" ADD CONSTRAINT "expense_report_changes_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_report_changes" ADD CONSTRAINT "expense_report_changes_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_report_notes_report_id" ON "expense_report_notes" ("report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_report_changes_report_id" ON "expense_report_changes" ("report_id");
--> statement-breakpoint
INSERT INTO "expense_report_notes" ("report_id", "author_name", "body", "created_at")
SELECT "id", 'Staff', "staff_notes", COALESCE("updated_at", "submitted_at")
FROM "expense_reports"
WHERE "staff_notes" IS NOT NULL AND btrim("staff_notes") <> '';
--> statement-breakpoint
ALTER TABLE "expense_reports" DROP COLUMN IF EXISTS "staff_notes";
