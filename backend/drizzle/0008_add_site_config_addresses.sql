ALTER TABLE "site_config" ADD COLUMN IF NOT EXISTS "physical_address_line1" text;
ALTER TABLE "site_config" ADD COLUMN IF NOT EXISTS "physical_address_line2" text;
ALTER TABLE "site_config" ADD COLUMN IF NOT EXISTS "mailing_address_line1" text;
ALTER TABLE "site_config" ADD COLUMN IF NOT EXISTS "mailing_address_line2" text;
UPDATE "site_config"
SET
  physical_address_line1 = COALESCE(physical_address_line1, '2310 So Hi Drive'),
  physical_address_line2 = COALESCE(physical_address_line2, 'Durham, NC 27703'),
  mailing_address_line1 = COALESCE(mailing_address_line1, 'P.O. Box 14628'),
  mailing_address_line2 = COALESCE(mailing_address_line2, 'Durham, NC 27709')
WHERE id = 1;
