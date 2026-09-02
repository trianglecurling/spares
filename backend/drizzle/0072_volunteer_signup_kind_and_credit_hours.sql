ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "signup_kind" text DEFAULT 'volunteering' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_signup_kind" ON "volunteer_programs" ("signup_kind");
--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN IF NOT EXISTS "credit_hours" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "volunteer_shifts"
SET "credit_hours" = ROUND(
  GREATEST(
    0,
    EXTRACT(EPOCH FROM ((end_dt)::timestamptz - (start_dt)::timestamptz)) / 3600.0
  )::numeric,
  1
);
