-- FK: messaging.webhook_deliveries → messaging.webhook_subscriptions
--
-- `subscription_id` was NOT NULL with no foreign key, in the schema or in any migration, while
-- `WebhooksService.delete` hard-deletes the parent row. So deleting a subscription left its
-- deliveries behind, pointing at an id that no longer resolves.
--
-- Nothing reports them. `WebhookRelayService` claims work with an INNER JOIN onto
-- `webhook_subscriptions`, so an orphaned row simply stops being selected: it stays `pending` with
-- `attempts = 0` forever, is never retried, never dead-lettered, and never reaches the
-- `outboxDeadLetter` alarm — which watches the dead-letter field, not the pending queue. The
-- deliveries table grows and the operator sees nothing.
--
-- CASCADE rather than RESTRICT. A delivery exists only to be sent to one subscription; without that
-- subscription there is nowhere to send it and no way to retry it, so keeping the row preserves
-- nothing but the leak. RESTRICT would be defensible for history, but it breaks the existing DELETE
-- endpoint for any subscription that has ever fired, and `webhook_subscriptions.active = false`
-- already exists as the non-destructive way to stop a subscription without losing its history.
--
-- SET NULL is not available: the column is NOT NULL, and a delivery with no subscription is not a
-- meaningful row.
--
-- Audit entries are unaffected either way — they live in `audit.audit_logs` and reference deliveries
-- by id without a foreign key, deliberately, so the trail outlives the operational row.

-- Existing orphans must go first, or the constraint cannot be validated. These are exactly the rows
-- described above: undeliverable since the moment their subscription was removed, and invisible to
-- the relay's INNER JOIN ever since.
DELETE FROM messaging.webhook_deliveries d
WHERE NOT EXISTS (
  SELECT 1 FROM messaging.webhook_subscriptions s WHERE s.id = d.subscription_id
);

--> statement-breakpoint

ALTER TABLE messaging.webhook_deliveries
  ADD CONSTRAINT fk_webhook_delivery_subscription
  FOREIGN KEY (subscription_id) REFERENCES messaging.webhook_subscriptions(id) ON DELETE CASCADE;
