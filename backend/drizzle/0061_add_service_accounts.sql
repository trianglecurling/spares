ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "account_kind" text DEFAULT 'person' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_members_account_kind" ON "members" ("account_kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "personal_access_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by_member_id" integer,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_access_tokens_token_hash_unique" ON "personal_access_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_personal_access_tokens_token_hash" ON "personal_access_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_personal_access_tokens_member_id" ON "personal_access_tokens" ("member_id");
