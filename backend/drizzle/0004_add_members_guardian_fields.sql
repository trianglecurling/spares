ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_first_name" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_last_name" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_email" text;
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "guardian_phone" text;
