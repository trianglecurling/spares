ALTER TABLE "volunteer_roles" ADD COLUMN IF NOT EXISTS "default_duration_minutes" integer DEFAULT 180 NOT NULL;
