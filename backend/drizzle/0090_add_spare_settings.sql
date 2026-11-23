ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "spare_bye_priority_window_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "spare_urgent_threshold_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "server_config" ADD COLUMN IF NOT EXISTS "spare_reissue_cooldown_hours" integer DEFAULT 72 NOT NULL;
