CREATE TABLE IF NOT EXISTS "dashboard_sections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dashboard_sections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_sections_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_sections_key" ON "dashboard_sections" USING btree ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_sections_sort_order" ON "dashboard_sections" USING btree ("sort_order");
