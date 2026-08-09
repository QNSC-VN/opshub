/**
 * Audit action catalogue — the single source of truth for audit action codes.
 *
 * WHY A CATALOGUE AND NOT INLINE STRINGS
 * --------------------------------------
 * 80 audit calls used inline literals under two rival conventions, and the two were not
 * alternatives — they were BOTH being written for the same event. A service wrote
 * `authz.role.created` while its controller wrote `rbac.role_created` for the same role, so
 * every RBAC action, every compliance action, a leave request and an access-grant revocation
 * landed in `audit_logs` TWICE under two different names. Measured, not inferred: one
 * `POST /authz/roles` produced `authz.role.created` and `rbac.role_created` against one
 * `resource_id`, and one software add produced `software.added` and
 * `compliance.software_added`.
 *
 * A typed union makes that unrepresentable — a literal that is not in this file is a compile
 * error, and there is exactly one name per event.
 *
 * NAMING: `<resource>.<action>`, resource singular snake_case, action PAST TENSE. Past tense
 * because an audit entry records something that happened. The frontend's badge colours are
 * keyed on the last dotted segment, so the verb has to be that segment.
 *
 * THESE CODES ARE A CONTRACT. `audit_logs.action` is read by the Audit Log viewer and is the
 * field any future SIEM export will key on, so a code must be added, never renamed in place —
 * renaming orphans every row already written under the old name. The normalisation this file
 * performs is a one-time exception taken deliberately BEFORE opshub carries real data: there
 * is no downstream consumer yet and no deployed environment to migrate, which is the only
 * window in which unifying two vocabularies is free.
 */
export const AUDIT_ACTION = {
  // ── Access / RBAC ──
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  ROLE_PERMISSIONS_UPDATED: 'role.permissions_updated',
  ROLE_ASSIGNED: 'role.assigned',
  ROLE_REVOKED: 'role.revoked',
  ROLE_SYNCED: 'role.synced',
  DELEGATION_CREATED: 'delegation.created',
  DELEGATION_REVOKED: 'delegation.revoked',

  // ── Access requests ──
  ACCESS_REQUEST_SUBMITTED: 'access_request.submitted',
  ACCESS_REQUEST_APPROVED: 'access_request.approved',
  ACCESS_REQUEST_REJECTED: 'access_request.rejected',
  ACCESS_GRANT_REVOKED: 'access_grant.revoked',

  // ── Identity / employees ──
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_STATUS_CHANGED: 'employee.status_changed',
  EMPLOYEE_AVATAR_UPDATED: 'employee.avatar_updated',
  EMPLOYEE_AVATAR_DELETED: 'employee.avatar_deleted',

  // ── Assets ──
  ASSET_CREATED: 'asset.created',
  ASSET_ASSIGNED: 'asset.assigned',
  ASSET_UNASSIGNED: 'asset.unassigned',
  ASSET_RETIRED: 'asset.retired',
  ASSET_PHOTO_UPDATED: 'asset.photo_updated',

  // ── Compliance ──
  SOFTWARE_ADDED: 'software.added',
  SOFTWARE_UPDATED: 'software.updated',
  FINDING_ACKNOWLEDGED: 'finding.acknowledged',
  FINDING_RESOLVED: 'finding.resolved',
  FINDING_RISK_ACCEPTED: 'finding.risk_accepted',
  SHADOW_IT_SCAN_TRIGGERED: 'shadow_it.scan_triggered',

  // ── Licenses ──
  LICENSE_CREATED: 'license.created',
  LICENSE_UPDATED: 'license.updated',
  LICENSE_DELETED: 'license.deleted',
  LICENSE_SEAT_ASSIGNED: 'license.seat_assigned',
  LICENSE_SEAT_REVOKED: 'license.seat_revoked',

  // ── Service catalog ──
  CATALOG_ITEM_CREATED: 'catalog_item.created',
  CATALOG_ITEM_UPDATED: 'catalog_item.updated',
  CATALOG_ITEM_DELETED: 'catalog_item.deleted',
  CATALOG_REQUEST_SUBMITTED: 'catalog_request.submitted',

  // ── Requests (generic engine) ──
  REQUEST_APPROVED: 'request.approved',
  REQUEST_REJECTED: 'request.rejected',
  REQUEST_CANCELLED: 'request.cancelled',
  REQUEST_COMMENT_ADDED: 'request.comment_added',

  // ── Workforce ──
  LEAVE_REQUESTED: 'leave.requested',
  LEAVE_APPROVED: 'leave.approved',
  LEAVE_REJECTED: 'leave.rejected',
  LEAVE_CANCELLED: 'leave.cancelled',
  LEAVE_DOCUMENT_UPLOADED: 'leave.document_uploaded',
  LEAVE_ENTITLEMENT_SET: 'leave_entitlement.set',
  HOLIDAY_DECLARED: 'holiday.declared',
  HOLIDAY_REMOVED: 'holiday.removed',
  TIMESHEET_CREATED: 'timesheet.created',
  TIMESHEET_SUBMITTED: 'timesheet.submitted',
  TIMESHEET_APPROVED: 'timesheet.approved',
  TIMESHEET_REJECTED: 'timesheet.rejected',
  SHIFT_LOGGED: 'shift.logged',
  OVERTIME_LOGGED: 'overtime.logged',
  OVERTIME_APPROVED: 'overtime.approved',
  OVERTIME_REJECTED: 'overtime.rejected',
  ONBOARDING_SUBMITTED: 'onboarding.submitted',
  OFFBOARDING_SUBMITTED: 'offboarding.submitted',

  // ── Controlled documents ──
  DOCUMENT_CREATED: 'document.created',
  DOCUMENT_RETIRED: 'document.retired',
  DOCUMENT_DRAFT_CREATED: 'document.draft_created',
  DOCUMENT_PUBLISHED: 'document.published',
  DOCUMENT_ACKNOWLEDGED: 'document.acknowledged',

  // ── Webhooks ──
  WEBHOOK_SUBSCRIPTION_CREATED: 'webhook_subscription.created',
  WEBHOOK_SUBSCRIPTION_DELETED: 'webhook_subscription.deleted',
  WEBHOOK_SUBSCRIPTION_ENABLED: 'webhook_subscription.enabled',
  WEBHOOK_SUBSCRIPTION_DISABLED: 'webhook_subscription.disabled',
  WEBHOOK_DELIVERY_RETRIED: 'webhook_delivery.retried',

  /**
   * ── Emitted by `@qnsc-vn/identity`, NOT by this repo ──
   *
   * These arrive as plain strings through `AuditServiceAdapter` and opshub cannot rename
   * them; they are declared here so the adapter has something to narrow to and so the
   * viewer's vocabulary is complete. `identity-audit-actions.spec.ts` reads the package's
   * own dist and fails if it emits an action this list does not carry, which is what turns a
   * package upgrade that adds one into a test failure rather than a silent type assertion.
   */
  AUTH_LOGIN_SSO: 'auth.login.sso',
  AUTH_LOGIN_DEV: 'auth.login.dev',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_SWITCH_WORKSPACE: 'auth.switch_workspace',
  AUTH_TOKEN_THEFT_DETECTED: 'auth.token_theft_detected',
  ACCESS_ROLE_ELEVATED: 'access.role_elevated',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/**
 * Audit resource types — mirror `audit_logs.resource_type` (the entity the action targeted).
 *
 * Snake_case throughout. Three of the previous values were kebab-case (`asset-photo`,
 * `employee-avatar`, `leave-document`) while the other twenty-one were snake, so filtering
 * the viewer by resource type needed you to know which spelling a given writer had picked.
 */
export const AUDIT_RESOURCE = {
  ROLE: 'role',
  ROLE_ASSIGNMENT: 'role_assignment',
  DELEGATION: 'delegation',
  ACCESS_REQUEST: 'access_request',
  ACCESS_GRANT: 'access_grant',
  EMPLOYEE: 'employee',
  EMPLOYEE_AVATAR: 'employee_avatar',
  ASSET: 'asset',
  ASSET_PHOTO: 'asset_photo',
  SOFTWARE_CATALOG: 'software_catalog',
  SOFTWARE_LICENSE: 'software_license',
  LICENSE_ASSIGNMENT: 'license_assignment',
  COMPLIANCE: 'compliance',
  COMPLIANCE_FINDING: 'compliance_finding',
  CATALOG_ITEM: 'catalog_item',
  CATALOG_REQUEST: 'catalog_request',
  REQUEST: 'request',
  LEAVE_REQUEST: 'leave_request',
  LEAVE_DOCUMENT: 'leave_document',
  LEAVE_ENTITLEMENT: 'leave_entitlement',
  HOLIDAY: 'holiday',
  DOCUMENT: 'document',
  DOCUMENT_VERSION: 'document_version',
  TIMESHEET: 'timesheet',
  SHIFT_LOG: 'shift_log',
  OVERTIME_ENTRY: 'overtime_entry',
  WEBHOOK_SUBSCRIPTION: 'webhook_subscription',
  WEBHOOK_DELIVERY: 'webhook_delivery',
  // Emitted by `@qnsc-vn/identity` — see the actions section above.
  SESSION: 'session',
  USER: 'user',
} as const;

export type AuditResource = (typeof AUDIT_RESOURCE)[keyof typeof AUDIT_RESOURCE];
