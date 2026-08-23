ALTER TABLE "registration_invoices" ADD COLUMN IF NOT EXISTS "offline_payment_note" text;
ALTER TABLE "registration_invoices" ADD COLUMN IF NOT EXISTS "offline_recorded_by_member_id" integer;
