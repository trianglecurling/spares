ALTER TABLE "volunteer_signups" ALTER COLUMN "member_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "volunteer_signups" ADD COLUMN IF NOT EXISTS "guest_name" text;
--> statement-breakpoint
ALTER TABLE "volunteer_signups" ADD COLUMN IF NOT EXISTS "comments" text;
--> statement-breakpoint
ALTER TABLE "volunteer_signups" ADD COLUMN IF NOT EXISTS "signed_up_by_member_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "volunteer_signups" ADD CONSTRAINT "volunteer_signups_signed_up_by_member_id_members_id_fk" FOREIGN KEY ("signed_up_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
