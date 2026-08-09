ALTER TABLE "volunteer_programs" ADD COLUMN IF NOT EXISTS "feature_on_dashboard" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_programs_feature_on_dashboard" ON "volunteer_programs" ("feature_on_dashboard");
