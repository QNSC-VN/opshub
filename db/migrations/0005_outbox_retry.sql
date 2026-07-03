-- Migrate outbox_events: replace boolean `published` flag with status/attempts/last_error
-- and rename published_at → sent_at for semantic clarity.
-- Adds retry support: relay now increments attempts and sets status='failed' after 5 attempts.

ALTER TABLE "messaging"."outbox_events"
  ADD COLUMN "status"     varchar(20)              NOT NULL DEFAULT 'pending',
  ADD COLUMN "attempts"   integer                  NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" text,
  ADD COLUMN "sent_at"    timestamp with time zone;

-- Backfill existing rows: map published flag → status, copy published_at → sent_at
UPDATE "messaging"."outbox_events"
SET
  "status"  = CASE WHEN "published" THEN 'sent' ELSE 'pending' END,
  "sent_at" = "published_at";

-- Remove superseded columns
ALTER TABLE "messaging"."outbox_events"
  DROP COLUMN "published",
  DROP COLUMN "published_at";

-- Replace old index with one that covers only actionable rows
DROP INDEX IF EXISTS "messaging"."ix_outbox_unpublished";
CREATE INDEX "ix_outbox_pending" ON "messaging"."outbox_events" ("status", "created_at");
