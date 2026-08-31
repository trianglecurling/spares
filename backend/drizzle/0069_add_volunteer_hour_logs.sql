CREATE TABLE IF NOT EXISTS "volunteer_hour_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "volunteer_hour_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"member_id" integer NOT NULL,
	"volunteer_date" date NOT NULL,
	"hours" double precision NOT NULL,
	"description" text NOT NULL,
	"created_by_member_id" integer,
	"updated_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_hour_logs" ADD CONSTRAINT "volunteer_hour_logs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_hour_logs" ADD CONSTRAINT "volunteer_hour_logs_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_hour_logs" ADD CONSTRAINT "volunteer_hour_logs_updated_by_member_id_members_id_fk" FOREIGN KEY ("updated_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_hour_logs_member_id" ON "volunteer_hour_logs" ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_hour_logs_volunteer_date" ON "volunteer_hour_logs" ("volunteer_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_volunteer_hour_logs_created_at" ON "volunteer_hour_logs" ("created_at");
