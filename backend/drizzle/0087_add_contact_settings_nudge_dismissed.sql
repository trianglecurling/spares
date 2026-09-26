ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "contact_settings_nudge_dismissed" integer DEFAULT 0 NOT NULL;
