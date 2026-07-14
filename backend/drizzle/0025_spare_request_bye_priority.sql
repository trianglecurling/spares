ALTER TABLE "spare_requests" ADD COLUMN IF NOT EXISTS "public_listing_at" timestamp;
--> statement-breakpoint
ALTER TABLE "spare_request_notification_queue" ADD COLUMN IF NOT EXISTS "is_bye_priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "spare_request_notification_queue" ADD COLUMN IF NOT EXISTS "was_delivered" integer DEFAULT 0 NOT NULL;
