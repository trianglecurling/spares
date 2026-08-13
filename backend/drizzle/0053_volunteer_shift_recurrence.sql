ALTER TABLE "volunteer_shifts" ADD COLUMN IF NOT EXISTS "recurrence_series_id" integer;
--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN IF NOT EXISTS "recurrence_rule" text;
--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN IF NOT EXISTS "recurrence_date" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shifts_recurrence_series_id" ON "volunteer_shifts" ("recurrence_series_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "volunteer_shift_exceptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_shift_exceptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recurrence_series_id" integer NOT NULL,
	"exception_date" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_shift_exceptions_series_id" ON "volunteer_shift_exceptions" ("recurrence_series_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "volunteer_shift_exceptions_series_date_unique_pg" ON "volunteer_shift_exceptions" ("recurrence_series_id", "exception_date");
