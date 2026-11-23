CREATE TABLE IF NOT EXISTS "donation_collections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "donation_collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"cause_name" text NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"minimum_amount_minor" integer DEFAULT 100 NOT NULL,
	"payment_item_name" text,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "donation_collection_managers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "donation_collection_managers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collection_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "donation_collections_slug_unique" ON "donation_collections" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_donation_collections_end_date" ON "donation_collections" USING btree ("end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_donation_collections_created_by" ON "donation_collections" USING btree ("created_by_member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_donation_collection_managers_collection_id" ON "donation_collection_managers" USING btree ("collection_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_donation_collection_managers_member_id" ON "donation_collection_managers" USING btree ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "donation_collection_managers_collection_member_unique_pg" ON "donation_collection_managers" USING btree ("collection_id","member_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donation_collections" ADD CONSTRAINT "donation_collections_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donation_collection_managers" ADD CONSTRAINT "donation_collection_managers_collection_id_donation_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."donation_collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donation_collection_managers" ADD CONSTRAINT "donation_collection_managers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
