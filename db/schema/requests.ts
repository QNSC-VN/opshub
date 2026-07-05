/**
 * requests schema — universal request/approval state machine. All request-like
 * workflows (access requests, leave, overtime, onboarding, offboarding …)
 * create a `request_items` row as their canonical state record. Domain tables
 * store extended payload and link back via `request_id`.
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { requestPriorityEnum, requestStatusEnum, requestDecisionEnum } from './enums';

export const requestsSchema = pgSchema('requests');

/**
 * Canonical state-machine row for every request lifecycle.
 * `payload` holds a searchable snapshot of domain-specific fields so the
 * unified inbox can display useful context without additional joins.
 */
export const requestItems = requestsSchema.table(
  'request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Discriminator matching the registered RequestTypeDef key. */
    type: varchar('type', { length: 80 }).notNull(),
    requesterId: uuid('requester_id').notNull(),
    /** Current assignee (approver). Set on submit or after delegation. */
    assigneeId: uuid('assignee_id'),
    status: requestStatusEnum('status').notNull().default('pending'),
    priority: requestPriorityEnum('priority').notNull().default('normal'),
    /** Searchable domain snapshot (subject, target, dates, etc). Read-only after submit. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    resolutionNote: text('resolution_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Absolute deadline; expiry relay transitions status → expired after this time. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * SLA threshold in hours copied from the TypeDef at submit time.
     * Null = no SLA defined for this request type.
     */
    slaHours: integer('sla_hours'),
    /** Absolute SLA deadline (submittedAt + slaHours). Null if no SLA. */
    slaDeadline: timestamp('sla_deadline', { withTimezone: true }),
    /** Timestamp when the SLA breach was first detected by the cron. Null = not yet breached. */
    slaBreachedAt: timestamp('sla_breached_at', { withTimezone: true }),
    /**
     * Current approval step (1-based). Incremented by the engine as each step
     * is approved in a multi-step chain. Always 1 for single-step workflows.
     */
    currentStep: integer('current_step').notNull().default(1),
    /**
     * Total number of approval steps required, copied from the TypeDef at submit
     * time. 1 = single-step (default). Immutable after submit.
     */
    totalSteps: integer('total_steps').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requesterIdx: index('ix_ri_requester').on(t.requesterId, t.createdAt),
    statusTypeIdx: index('ix_ri_status_type').on(t.status, t.type, t.createdAt),
    assigneeIdx: index('ix_ri_assignee').on(t.assigneeId, t.status),
    expiryIdx: index('ix_ri_expiry').on(t.expiresAt, t.status),
    slaIdx: index('ix_ri_sla').on(t.slaDeadline, t.status),
  }),
);

/**
 * Immutable append-only log of each approval step. Supports multi-step
 * (parallel or sequential) workflows by incrementing `step`. First-step
 * decisions from a single approver are the common case (step=1).
 */
export const requestApprovals = requestsSchema.table(
  'request_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requestItems.id, { onDelete: 'cascade' }),
    step: integer('step').notNull().default(1),
    approverId: uuid('approver_id').notNull(),
    decision: requestDecisionEnum('decision').notNull(),
    note: text('note'),
    /**
     * If the approver was acting as a delegate for another user (approval delegation),
     * this field records the original delegator's user id. Null = direct approval.
     */
    delegatedFromId: uuid('delegated_from_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('ix_ra_request').on(t.requestId, t.step),
  }),
);

/**
 * Discussion thread attached to a request item. Any party (requester or
 * approver) can post comments while the request is open. Unlike approval notes,
 * comments do not trigger state transitions — they are purely informational.
 */
export const requestComments = requestsSchema.table(
  'request_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requestItems.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    /** Set when the author edits the comment. Null = never edited. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('ix_rcomm_request').on(t.requestId, t.createdAt),
  }),
);
