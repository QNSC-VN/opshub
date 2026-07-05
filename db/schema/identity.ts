/**
 * identity schema — employees (single-tenant directory, synced from Entra ID).
 */
import { pgSchema, uuid, varchar, jsonb, timestamp, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employeeStatusEnum } from './enums';

export const identitySchema = pgSchema('identity');

export const employees = identitySchema.table(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Entra ID object id (oid claim) — null for locally-created records. */
    entraOid: varchar('entra_oid', { length: 64 }),
    email: varchar('email', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    department: varchar('department', { length: 120 }),
    jobTitle: varchar('job_title', { length: 120 }),
    managerId: uuid('manager_id'),
    /** Application roles, e.g. ['it-admin','security']. Drives RBAC. */
    roles: jsonb('roles').notNull().$type<string[]>().default([]),
    status: employeeStatusEnum('status').notNull().default('active'),
    /** S3 stored_files.id for the employee's profile photo — null until uploaded. */
    photoStorageKey: varchar('photo_storage_key', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('uq_employee_email').on(t.email),
    // Partial: only enforce uniqueness for non-null Entra OIDs.
    // Locally-created employees (no Entra sync) may all have entra_oid = NULL.
    entraIdx: uniqueIndex('uq_employee_entra_oid')
      .on(t.entraOid)
      .where(sql`entra_oid IS NOT NULL`),
    statusIdx: index('ix_employee_status').on(t.status),
  }),
);

/**
 * Server-side refresh token table.
 * Raw tokens never leave the server — only the SHA-256 hash is stored.
 * This allows instant revocation (logout, offboarding, security incident).
 */
export const refreshTokens = identitySchema.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    /** SHA-256(rawToken). Raw token lives only in the HttpOnly cookie — never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /**
     * Family ID groups all rotated tokens from the same login.
     * If a revoked token is used (theft detection), the entire family is revoked.
     * Copied from Rally's auth_sessions pattern.
     */
    familyId: uuid('family_id').notNull(),
    /** Always 'sso' — session established via Entra ID OIDC. Kept as varchar for forward compatibility. */
    authMethod: varchar('auth_method', { length: 10 }).notNull().default('sso'),
    /** True once the token has been rotated or explicitly revoked. */
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashIdx: uniqueIndex('uq_refresh_token_hash').on(t.tokenHash),
    employeeIdx: index('ix_refresh_token_employee').on(t.employeeId),
    familyIdx: index('ix_refresh_token_family').on(t.familyId),
    expiryIdx: index('ix_refresh_token_expiry').on(t.expiresAt),
  }),
);
