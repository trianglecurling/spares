ALTER TABLE "expense_receipts" ADD COLUMN IF NOT EXISTS "document_type" text DEFAULT 'receipt' NOT NULL;
