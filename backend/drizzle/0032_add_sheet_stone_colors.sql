ALTER TABLE "sheets" ADD COLUMN IF NOT EXISTS "stone_color_1" text DEFAULT 'red' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sheets" ADD COLUMN IF NOT EXISTS "stone_color_2" text DEFAULT 'yellow' NOT NULL;
