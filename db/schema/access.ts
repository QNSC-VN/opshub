/**
 * access schema — privileged access requests + active grants (temp local admin, PIM, etc).
 */
import { pgSchema, uuid, integer, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { accessRequestStatusEnum, accessTypeEnum } from './enums';
import { requestItems } from './requests';

export const accessSchema = pgSchema('access');

export const accessRequests = accessSchema.table(
  'access_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull(),
    accessType: accessTypeEnum('access_type').notNull(),
    /** Target resource: asset tag, app name, PIM role, etc. */
    target: varchar('target', { length: 200 }).notNull(),
    justification: text('justification').notNull(),
    /** Requested duration in hours (time-boxed privileged access). */
    durationHours: integer('duration_hours').notNull(),
    status: accessRequestStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id'),
    reviewNote: text('review_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Link to the universal request engine row (null for requests pre-dating the engine). */
    requestId: uuid('request_id').references(() => requestItems.id, { onDelete: 'set null' }),
  },
  (t) => ({
    requesterIdx: index('ix_access_request_requester').on(t.requesterId),
    statusIdx: index('ix_access_request_status').on(t.status, t.createdAt),
  }),
);

export const accessGrants = accessSchema.table(
  'access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull(),
    granteeId: uuid('grantee_id').notNull(),
    accessType: accessTypeEnum('access_type').notNull(),
    target: varchar('target', { length: 200 }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    granteeIdx: index('ix_access_grant_grantee').on(t.granteeId),
    expiryIdx: index('ix_access_grant_expiry').on(t.expiresAt),
  }),
);
