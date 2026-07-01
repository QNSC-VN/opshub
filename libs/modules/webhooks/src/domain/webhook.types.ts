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
