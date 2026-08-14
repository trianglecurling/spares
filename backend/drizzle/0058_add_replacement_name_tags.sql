ALTER TABLE "registration_price_settings" ADD COLUMN IF NOT EXISTS "replacement_name_tag_fee_minor" integer NOT NULL DEFAULT 0;
ALTER TABLE "curling_registrations" ADD COLUMN IF NOT EXISTS "name_tag_replacement_quantity" integer;
