ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "menu_items_link_type_check";--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_link_type_check" CHECK (link_type IS NULL OR link_type IN ('internal', 'external', 'separator'));
