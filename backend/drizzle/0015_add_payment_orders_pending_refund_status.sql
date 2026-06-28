ALTER TABLE "payment_orders" DROP CONSTRAINT IF EXISTS "payment_orders_status_check";--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_status_check" CHECK (status = ANY (ARRAY['created'::text, 'pending'::text, 'succeeded'::text, 'failed'::text, 'pending_refund'::text, 'refunded'::text, 'partially_refunded'::text]));--> statement-breakpoint
ALTER TABLE "payment_transactions" DROP CONSTRAINT IF EXISTS "payment_transactions_status_check";--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_status_check" CHECK (status = ANY (ARRAY['created'::text, 'pending'::text, 'succeeded'::text, 'failed'::text, 'pending_refund'::text, 'refunded'::text, 'partially_refunded'::text]));
