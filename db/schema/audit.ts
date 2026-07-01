/**
 * audit schema — OpsHub's own action log (who did what in OpsHub).
 * Distinct from endpoint/security audit data ingested from EDR/MDM.
 */
import { pgSchema, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const auditSchema = pgSchema('audit');

export const auditLogs = auditSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id'),
    actorEmail: varchar('actor_email', { length: 255 }),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 60 }).notNull(),
    resourceId: varchar('resource_id', { length: 64 }),
    changes: jsonb('changes'),
    metadata: jsonb('metadata').notNull().$type<Record<string, unknown>>().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('ix_audit_actor').on(t.actorId, t.occurredAt),
    resourceIdx: index('ix_audit_resource').on(t.resourceType, t.resourceId),
    timeIdx: index('ix_audit_time').on(t.occurredAt),
  }),
);
