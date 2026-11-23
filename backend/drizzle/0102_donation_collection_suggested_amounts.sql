ALTER TABLE "donation_collections" ADD COLUMN IF NOT EXISTS "suggested_amounts_minor" text DEFAULT '[2500,5000,10000,25000,50000]' NOT NULL;
