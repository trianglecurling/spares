CREATE TABLE IF NOT EXISTS "public_contact_recipients" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "public_contact_recipients_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"email" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_contact_recipients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_public_contact_recipients_slug" ON "public_contact_recipients" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_public_contact_recipients_sort_order" ON "public_contact_recipients" USING btree ("sort_order");
