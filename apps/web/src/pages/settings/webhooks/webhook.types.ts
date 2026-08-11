import type { components } from '@/shared/api/types';

/**
 * The webhook types and the event vocabulary.
 *
 * From the generated schemas rather than hand-written — the finops screen showed what happens when a
 * page keeps its own copy of a response shape.
 */
export type WebhookSubscription = components['schemas']['WebhookSubscriptionResponseDto'];

export const ALL_EVENTS = [
  'request.submitted',
  'request.step_approved',
  'request.approved',
  'request.rejected',
  'request.cancelled',
  'request.expired',
] as const;

export type EventType = (typeof ALL_EVENTS)[number];
