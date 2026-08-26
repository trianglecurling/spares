ALTER TABLE "league_waitlists" ADD COLUMN IF NOT EXISTS "frozen_entry_count" integer DEFAULT 0 NOT NULL;
