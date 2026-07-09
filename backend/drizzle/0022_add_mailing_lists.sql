CREATE TABLE IF NOT EXISTS "mailing_lists" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mailing_lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"mautic_segment_id" integer NOT NULL,
	"owner_member_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"include_questions_comments" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mailing_lists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mailing_lists_slug" ON "mailing_lists" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mailing_lists_owner_member_id" ON "mailing_lists" USING btree ("owner_member_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailing_lists" ADD CONSTRAINT "mailing_lists_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
