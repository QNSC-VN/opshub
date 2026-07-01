/**
 * Authorization (RBAC) schema — fine-grained permissions, roles, scoped role
 * assignments, and approval delegations. Coexists with the legacy coarse
 * `identity.employees.roles` jsonb column (which still drives the JWT); the
 * PolicyGuard resolves effective permissions from these tables.
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { scopeTypeEnum } from './enums';

export const authzSchema = pgSchema('authz');

/** Catalog of all permission keys (resource.action), e.g. `asset.reassign`. */
export const permissions = authzSchema.table('permissions', {
  key: varchar('key', { length: 120 }).primaryKey(),
  description: text('description').notNull(),
});

/** Named role grouping a set of permissions, e.g. `it-admin`. */
export const roles = authzSchema.table(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    /** System roles are seed-managed and cannot be deleted via the API. */
    system: boolean('system').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUq: uniqueIndex('uq_role_key').on(t.key),
  }),
);

/** Role → permission membership (many-to-many). */
export const rolePermissions = authzSchema.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 120 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionKey] }),
  }),
);

/**
 * Scoped role grant to a user. `scopeType=global` (scopeId null) grants the
 * role everywhere; narrower scopes (team/dept/region/self) constrain the grant
 * to matching resources. Optional `expiresAt` supports time-boxed access.
 */
export const userRoleAssignments = authzSchema.table(
  'user_role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    scopeType: scopeTypeEnum('scope_type').notNull().default('global'),
    scopeId: varchar('scope_id', { length: 120 }),
    grantedBy: uuid('granted_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Two partial indexes cover both cases:
    // 1. Global assignments (scope_id IS NULL) — enforce uniqueness ignoring the NULL column.
    // 2. Scoped assignments (scope_id IS NOT NULL) — standard composite uniqueness.
    // This avoids the PostgreSQL NULL != NULL gotcha in unique indexes.
    uniqGlobal: uniqueIndex('uq_ura_user_role_global')
      .on(t.userId, t.roleId, t.scopeType)
      .where(sql`scope_id IS NULL`),
    uniqScoped: uniqueIndex('uq_ura_user_role_scoped')
      .on(t.userId, t.roleId, t.scopeType, t.scopeId)
      .where(sql`scope_id IS NOT NULL`),
    userIdx: index('ix_ura_user').on(t.userId),
  }),
);

/**
 * Temporary transfer of a user's approval authority to a delegate over a window
 * (e.g. while on leave). Consumed by the request/approval engine.
 */
export const approvalDelegations = authzSchema.table(
  'approval_delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUserId: uuid('from_user_id').notNull(),
    toUserId: uuid('to_user_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fromActiveIdx: index('ix_deleg_from_active').on(t.fromUserId, t.endsAt),
    // Needed by findActiveDelegationTo() — queried on every approve/reject.
    toActiveIdx: index('ix_deleg_to_active').on(t.toUserId, t.endsAt),
  }),
);
