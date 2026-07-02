CREATE TABLE IF NOT EXISTS "event_waitlist_offers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_waitlist_offers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" integer NOT NULL,
	"registration_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"declined_by" text,
	"respond_by_days" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"response_token" text NOT NULL,
	"payment_order_id" integer,
	"created_by_member_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "event_waitlist_offers" ADD CONSTRAINT "event_waitlist_offers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_waitlist_offers" ADD CONSTRAINT "event_waitlist_offers_registration_id_event_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."event_registrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_waitlist_offers" ADD CONSTRAINT "event_waitlist_offers_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_waitlist_offers_event_id" ON "event_waitlist_offers" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_waitlist_offers_registration_id" ON "event_waitlist_offers" USING btree ("registration_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_waitlist_offers_status" ON "event_waitlist_offers" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_event_waitlist_offers_expires_at" ON "event_waitlist_offers" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_event_waitlist_offers_response_token" ON "event_waitlist_offers" USING btree ("response_token");
