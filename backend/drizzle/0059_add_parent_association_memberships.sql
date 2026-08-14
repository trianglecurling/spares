ALTER TABLE "curling_registrations" ADD COLUMN IF NOT EXISTS "usa_curling_membership_opt_in" integer;
ALTER TABLE "curling_registrations" ADD COLUMN IF NOT EXISTS "uswca_membership_opt_in" integer;
