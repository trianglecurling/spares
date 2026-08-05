CREATE TABLE IF NOT EXISTS "board_meeting_minutes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "board_meeting_minutes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"meeting_date" date NOT NULL,
	"document_url" text NOT NULL,
	"comment" text,
	"created_by_member_id" integer,
	"updated_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_meeting_minutes" ADD CONSTRAINT "board_meeting_minutes_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_meeting_minutes" ADD CONSTRAINT "board_meeting_minutes_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_board_meeting_minutes_meeting_date" ON "board_meeting_minutes" ("meeting_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_meeting_minutes_document_url_unique" ON "board_meeting_minutes" ("document_url");
