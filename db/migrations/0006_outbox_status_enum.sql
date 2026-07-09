-- Convert all outbox status varchar columns to a shared outbox_status enum.
-- Covers: outbox_events, notification_outbox, email_outbox, webhook_deliveries.

CREATE TYPE "public"."outbox_status" AS ENUM ('pending', 'sent', 'failed');

-- Drop the varchar default before the type change (Postgres cannot auto-cast
-- the 'pending' text default to the enum), then restore it as the enum value.
ALTER TABLE "messaging"."outbox_events"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "public"."outbox_status" USING "status"::"public"."outbox_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "messaging"."notification_outbox"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "public"."outbox_status" USING "status"::"public"."outbox_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "messaging"."email_outbox"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "public"."outbox_status" USING "status"::"public"."outbox_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "messaging"."webhook_deliveries"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "public"."outbox_status" USING "status"::"public"."outbox_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';
