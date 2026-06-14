ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "allows_drop_ins" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "drop_in_fee_minor" integer;
