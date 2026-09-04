CREATE UNIQUE INDEX IF NOT EXISTS "expense_documents_one_receipt_per_expense"
ON "expense_documents" ("expense_item_id")
WHERE "document_type" = 'receipt';
