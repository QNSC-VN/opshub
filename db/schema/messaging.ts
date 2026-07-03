/**
 * messaging schema — transactional outbox tables.
 *
 * outbox_events        — generic domain-event relay to SQS (existing)
 * notification_outbox  — in-app notification queue, relayed every 5s by cron
 * email_outbox         — email send queue, relayed every 5s by cron
 *
 * All three follow the same pattern: written in the caller's DB transaction,
 * relayed by a cron service using SELECT … FOR UPDATE SKIP LOCKED.
 */
import {
  pgSchema, uuid, varchar, text, jsonb, timestamp, boolean, integer,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const messagingSchema = pgSchema('messaging');

// ── Generic domain-event outbox ──────────────────────────────────────────────

export const outboxEvents = messagingSchema.table(
  'outbox_events',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    aggregateType: varchar('aggregate_type', { length: 60 }).notNull(),
    aggregateId:   varchar('aggregate_id', { length: 64 }).notNull(),
    eventType:     varchar('event_type', { length: 100 }).notNull(),
    payload:       jsonb('payload').notNull().$type<Record<string, unknown>>(),
    /** 'pending' → relay picks up; 'sent' → SQS ack'd; 'failed' → max retries exceeded. */
    status:        varchar('status', { length: 20 }).notNull().default('pending'),
    attempts:      integer('attempts').notNull().default(0),
    lastError:     text('last_error'),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt:        timestamp('sent_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('ix_outbox_pending').on(t.status, t.createdAt),
  }),
);

// ── Notification outbox ──────────────────────────────────────────────────────

export const notificationOutbox = messagingSchema.table(
  'notification_outbox',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    recipientId:    uuid('recipient_id').notNull(),
    actorId:        uuid('actor_id'),
    type:           varchar('type', { length: 100 }).notNull(),
    vars:           jsonb('vars').notNull().$type<Record<string, unknown>>(),
    resourceId:     uuid('resource_id'),
    status:         varchar('status', { length: 20 }).notNull().default('pending'),
    attempts:       integer('attempts').notNull().default(0),
    lastError:      text('last_error'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    scheduledAt:    timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt:   timestamp('dispatched_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx:       index('ix_notif_outbox_pending').on(t.status, t.scheduledAt),
    // Partial: only enforce idempotency when a key is provided.
    idempotencyIdx:   uniqueIndex('uq_notif_outbox_idempotency')
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

// ── Email outbox ─────────────────────────────────────────────────────────────

export const emailOutbox = messagingSchema.table(
  'email_outbox',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    to:             varchar('to', { length: 320 }).notNull(),
    template:       varchar('template', { length: 100 }).notNull(),
    vars:           jsonb('vars').notNull().$type<Record<string, unknown>>(),
    status:         varchar('status', { length: 20 }).notNull().default('pending'),
    attempts:       integer('attempts').notNull().default(0),
    lastError:      text('last_error'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    /**
     * Optional: the internal user ID this email was scheduled for.
     * Populated for notification emails (e.g. access_request.approved).
     * NULL for transactional emails without a known recipient user.
     * Used to check notification_preferences before sending.
     */
    recipientId:    uuid('recipient_id'),
    scheduledAt:    timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt:         timestamp('sent_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx:     index('ix_email_outbox_pending').on(t.status, t.scheduledAt),
    // Partial: only enforce idempotency when a key is provided.
    idempotencyIdx: uniqueIndex('uq_email_outbox_idempotency')
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

// ── Webhook subscriptions ─────────────────────────────────────────────────────
//
// External systems register a URL + secret + list of event types they want
// to receive.  The delivery outbox (below) fans out a row per subscription
// each time a matching domain event fires.

export const webhookSubscriptions = messagingSchema.table(
  'webhook_subscriptions',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    url:         varchar('url', { length: 2048 }).notNull(),
    /** HMAC-SHA256 signing secret.  Never returned in GET responses. */
    secret:      varchar('secret', { length: 255 }).notNull(),
    /** Domain event types this subscription listens to, e.g. ['request.approved']. */
    events:      text('events').array().notNull().default([]),
    description: varchar('description', { length: 500 }),
    active:      boolean('active').notNull().default(true),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('ix_webhook_sub_active').on(t.active),
  }),
);

// ── Webhook delivery outbox ───────────────────────────────────────────────────

export const webhookDeliveries = messagingSchema.table(
  'webhook_deliveries',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull(),
    eventType:      varchar('event_type', { length: 100 }).notNull(),
    payload:        jsonb('payload').notNull().$type<Record<string, unknown>>(),
    status:         varchar('status', { length: 20 }).notNull().default('pending'),
    attempts:       integer('attempts').notNull().default(0),
    nextAttemptAt:  timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt:    timestamp('delivered_at', { withTimezone: true }),
    lastError:      text('last_error'),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pendingIdx: index('ix_webhook_del_pending').on(t.status, t.nextAttemptAt),
    subIdx:     index('ix_webhook_del_sub').on(t.subscriptionId),
  }),
);
