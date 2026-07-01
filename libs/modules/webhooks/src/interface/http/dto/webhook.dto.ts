import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Supported event types (used for validation) ──────────────────────────────

export const SUPPORTED_WEBHOOK_EVENTS = [
  'request.submitted',
  'request.step_approved',
  'request.approved',
  'request.rejected',
  'request.cancelled',
  'request.expired',
] as const;

// ─── Create subscription ──────────────────────────────────────────────────────

export const CreateWebhookSubscriptionSchema = z.object({
  url: z.string().url().max(2048),
  /** HMAC-SHA256 signing secret. Min 16 chars for adequate entropy. */
  secret: z.string().min(16).max(255),
  /** At least one event type must be subscribed. */
  events: z
    .array(z.enum(SUPPORTED_WEBHOOK_EVENTS))
    .min(1)
    .describe('Event types to subscribe to'),
  description: z.string().max(500).optional(),
});
export class CreateWebhookSubscriptionDto extends createZodDto(CreateWebhookSubscriptionSchema) {}

// ─── Activate / deactivate ────────────────────────────────────────────────────

export const SetActiveSchema = z.object({ active: z.boolean() });
export class SetActiveDto extends createZodDto(SetActiveSchema) {}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class WebhookSubscriptionResponseDto {
  id!: string;
  url!: string;
  /** secret is intentionally omitted from all responses */
  events!: string[];
  description!: string | null;
  active!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export class WebhookDeliveryResponseDto {
  id!: string;
  subscriptionId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  status!: string;
  attempts!: number;
  nextAttemptAt!: string;
  deliveredAt!: string | null;
  lastError!: string | null;
  createdAt!: string;
}
