ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "lifetime_member" integer DEFAULT 0 NOT NULL;
