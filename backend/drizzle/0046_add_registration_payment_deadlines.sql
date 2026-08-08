CREATE TABLE IF NOT EXISTS "registration_payment_deadlines" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "registration_payment_deadlines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"season_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"payment_deadline_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "registration_payment_deadlines" ADD CONSTRAINT "registration_payment_deadlines_season_id_curling_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."curling_seasons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "registration_payment_deadlines" ADD CONSTRAINT "registration_payment_deadlines_session_id_curling_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."curling_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registration_payment_deadlines_season_session_unique" ON "registration_payment_deadlines" USING btree ("season_id","session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registration_payment_deadlines_season_id" ON "registration_payment_deadlines" USING btree ("season_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registration_payment_deadlines_session_id" ON "registration_payment_deadlines" USING btree ("session_id");
