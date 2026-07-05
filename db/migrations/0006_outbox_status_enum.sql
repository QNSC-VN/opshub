-- Convert all outbox status varchar columns to a shared outbox_status enum.
-- Covers: outbox_events, notification_outbox, email_outbox, webhook_deliveries.

CREATE TYPE "public"."outbox_status" AS ENUM ('pending', 'sent', 'failed');

ALTER TABLE "messaging"."outbox_events"
  ALTER COLUMN "status" TYPE "public"."outbox_status"
  USING "status"::"public"."outbox_status";

ALTER TABLE "messaging"."notification_outbox"
  ALTER COLUMN "status" TYPE "public"."outbox_status"
  USING "status"::"public"."outbox_status";

ALTER TABLE "messaging"."email_outbox"
  ALTER COLUMN "status" TYPE "public"."outbox_status"
  USING "status"::"public"."outbox_status";

ALTER TABLE "messaging"."webhook_deliveries"
  ALTER COLUMN "status" TYPE "public"."outbox_status"
  USING "status"::"public"."outbox_status";
