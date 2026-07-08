-- Add 'delivered' to the shared outbox_status enum. Webhook deliveries use
-- 'delivered' as their terminal success state (a webhook is delivered to the
-- subscriber endpoint), while notification/email relays keep 'sent'.
ALTER TYPE "public"."outbox_status" ADD VALUE IF NOT EXISTS 'delivered';
