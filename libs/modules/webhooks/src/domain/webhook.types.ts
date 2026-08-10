export interface WebhookSubscription {
  id: string;
  url: string;
  /** secret is never returned in API responses */
  events: string[];
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * NARROWER than the column's type, deliberately.
 *
 * `webhook_deliveries.status` is the shared `outbox_status` enum, which also allows `sent` — the
 * value `AbstractOutboxRelay` writes for the email and notification outboxes. This relay overrides
 * `markSent` to write `delivered` instead, because a webhook is delivered to somebody else's server
 * and "sent" would not say whether they accepted it.
 *
 * So the three values here are the three this table can actually hold, and NOT deriving from the
 * enum is the point: a derived type would admit `sent` and lose the exhaustiveness that makes a
 * missing branch a compile error. If the relay ever stops overriding `markSent`, this breaks — which
 * is the correct direction to fail.
 */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface CreateSubscriptionInput {
  url: string;
  secret: string;
  events: string[];
  description?: string;
}
