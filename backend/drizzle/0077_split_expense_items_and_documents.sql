CREATE TABLE IF NOT EXISTS "expense_report_items" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "report_id" integer NOT NULL REFERENCES "expense_reports"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "expense_date" date NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL,
  "currency_other" text,
  "includes_durable_good" integer DEFAULT 0 NOT NULL,
  "no_receipt_explanation" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_documents" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "expense_item_id" integer NOT NULL REFERENCES "expense_report_items"("id") ON DELETE cascade,
  "document_type" text DEFAULT 'receipt' NOT NULL,
  "storage_key" text NOT NULL,
  "original_filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "expense_report_items" (
  "id",
  "report_id",
  "name",
  "expense_date",
  "amount_minor",
  "currency",
  "currency_other",
  "includes_durable_good",
  "no_receipt_explanation",
  "sort_order",
  "created_at",
  "updated_at"
)
OVERRIDING SYSTEM VALUE
SELECT
  "id",
  "report_id",
  "name",
  "receipt_date",
  "amount_minor",
  "currency",
  "currency_other",
  "includes_durable_good",
  NULL,
  "sort_order",
  "created_at",
  "updated_at"
FROM "expense_receipts"
WHERE "document_type" = 'receipt';
--> statement-breakpoint
INSERT INTO "expense_report_items" (
  "id",
  "report_id",
  "name",
  "expense_date",
  "amount_minor",
  "currency",
  "currency_other",
  "includes_durable_good",
  "no_receipt_explanation",
  "sort_order",
  "created_at",
  "updated_at"
)
OVERRIDING SYSTEM VALUE
SELECT
  source."id",
  source."report_id",
  source."name",
  source."receipt_date",
  source."amount_minor",
  source."currency",
  source."currency_other",
  source."includes_durable_good",
  'Migrated from a report that did not contain a receipt.',
  source."sort_order",
  source."created_at",
  source."updated_at"
FROM "expense_receipts" source
WHERE source."id" = (
  SELECT MIN(candidate."id")
  FROM "expense_receipts" candidate
  WHERE candidate."report_id" = source."report_id"
)
AND NOT EXISTS (
  SELECT 1
  FROM "expense_receipts" receipt
  WHERE receipt."report_id" = source."report_id"
    AND receipt."document_type" = 'receipt'
);
--> statement-breakpoint
INSERT INTO "expense_documents" (
  "id",
  "expense_item_id",
  "document_type",
  "storage_key",
  "original_filename",
  "mime_type",
  "byte_size",
  "sort_order",
  "created_at",
  "updated_at"
)
OVERRIDING SYSTEM VALUE
SELECT
  document."id",
  CASE
    WHEN document."document_type" = 'receipt' THEN document."id"
    ELSE COALESCE(
      (
        SELECT matching_receipt."id"
        FROM "expense_receipts" matching_receipt
        WHERE matching_receipt."report_id" = document."report_id"
          AND matching_receipt."document_type" = 'receipt'
          AND matching_receipt."receipt_date" = document."receipt_date"
          AND matching_receipt."amount_minor" = document."amount_minor"
          AND matching_receipt."currency" = document."currency"
          AND COALESCE(matching_receipt."currency_other", '') = COALESCE(document."currency_other", '')
        ORDER BY matching_receipt."id"
        LIMIT 1
      ),
      (
        SELECT first_receipt."id"
        FROM "expense_receipts" first_receipt
        WHERE first_receipt."report_id" = document."report_id"
          AND first_receipt."document_type" = 'receipt'
        ORDER BY first_receipt."sort_order", first_receipt."id"
        LIMIT 1
      ),
      (
        SELECT first_item."id"
        FROM "expense_report_items" first_item
        WHERE first_item."report_id" = document."report_id"
        ORDER BY first_item."sort_order", first_item."id"
        LIMIT 1
      )
    )
  END,
  document."document_type",
  document."storage_key",
  document."original_filename",
  document."mime_type",
  document."byte_size",
  document."sort_order",
  document."created_at",
  document."updated_at"
FROM "expense_receipts" document;
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('"expense_report_items"', 'id'),
  COALESCE((SELECT MAX("id") FROM "expense_report_items"), 1),
  EXISTS (SELECT 1 FROM "expense_report_items")
);
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('"expense_documents"', 'id'),
  COALESCE((SELECT MAX("id") FROM "expense_documents"), 1),
  EXISTS (SELECT 1 FROM "expense_documents")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_report_items_report_id" ON "expense_report_items" ("report_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_documents_expense_item_id" ON "expense_documents" ("expense_item_id");
--> statement-breakpoint
DROP TABLE "expense_receipts";
