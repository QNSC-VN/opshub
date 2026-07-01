/**
 * Shared application constants.
 *
 * Use these instead of inline magic strings/numbers.  Values must match the DB
 * enums and the RequestEngine type discriminators exactly — only change both
 * together.
 */

// ── Request engine type discriminators ───────────────────────────────────────

export const REQUEST_TYPE = {
  ACCESS_REQUEST: 'access_request',
  ONBOARDING: 'onboarding',
  OFFBOARDING: 'offboarding',
  LEAVE_REQUEST: 'leave_request',
  OVERTIME: 'overtime',
  CATALOG_REQUEST: 'catalog_request',
} as const;

export type RequestType = (typeof REQUEST_TYPE)[keyof typeof REQUEST_TYPE];

// ── RBAC role keys ────────────────────────────────────────────────────────────

export const ROLE = {
  IT_ADMIN: 'it-admin',
  SECURITY: 'security',
  HR: 'hr',
  AUDITOR: 'auditor',
  MANAGER: 'manager',
  EMPLOYEE: 'employee',
} as const;

export type RoleKey = (typeof ROLE)[keyof typeof ROLE];

// ── Permission keys ───────────────────────────────────────────────────────────

export const PERMISSION = {
  RBAC_MANAGE: 'rbac.manage',
  RBAC_READ: 'rbac.read',
  ACCESS_REQUEST_APPROVE: 'access_request.approve',
  ACCESS_REQUEST_SECURITY_APPROVE: 'access_request.security_approve',
  ONBOARDING_APPROVE: 'onboarding.approve',
  ONBOARDING_PROVISION: 'onboarding.provision',
  ONBOARDING_COMPLETE: 'onboarding.complete',
  OFFBOARDING_APPROVE: 'offboarding.approve',
  LEAVE_REQUEST_APPROVE: 'leave_request.approve',
  OVERTIME_APPROVE: 'overtime.approve',
  LICENSES_VIEW: 'licenses.view',
  LICENSES_MANAGE: 'licenses.manage',
  COMPLIANCE_VIEW: 'compliance.view',
  COMPLIANCE_MANAGE: 'compliance.manage',
  ASSETS_VIEW: 'assets.view',
  ASSETS_MANAGE: 'assets.manage',
  AUDIT_VIEW: 'audit.view',
  REQUESTS_APPROVE: 'requests.approve',
} as const;

export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION];

// ── Access request types ──────────────────────────────────────────────────────

export const ACCESS_TYPE = {
  LOCAL_ADMIN: 'local_admin',
  PIM_ROLE: 'pim_role',
  APP_ADMIN: 'app_admin',
  VPN: 'vpn',
  OTHER: 'other',
} as const;

export type AccessType = (typeof ACCESS_TYPE)[keyof typeof ACCESS_TYPE];

// ── Pagination ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = {
  DEFAULT: 50,
  MAX: 100,
  NOTIFICATION_DEFAULT: 20,
  AUDIT_MAX: 500,
} as const;

// ── Audit action strings ──────────────────────────────────────────────────────

export const AUDIT_ACTION = {
  // Auth
  AUTH_LOGIN_DEV: 'auth.login.dev',
  // Employees
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_STATUS_CHANGED: 'employee.status_changed',
  // Access requests
  ACCESS_REQUEST_SUBMITTED: 'access_request.submitted',
  ACCESS_REQUEST_APPROVED: 'access_request.approved',
  ACCESS_REQUEST_REJECTED: 'access_request.rejected',
  ACCESS_GRANT_REVOKED: 'access_grant.revoked',
  // Catalog
  CATALOG_ITEM_CREATED: 'catalog.item_created',
  CATALOG_ITEM_UPDATED: 'catalog.item_updated',
  CATALOG_ITEM_DELETED: 'catalog.item_deleted',
  CATALOG_REQUEST_SUBMITTED: 'catalog.request_submitted',
  // Licenses
  LICENSE_CREATED: 'license.created',
  LICENSE_UPDATED: 'license.updated',
  LICENSE_DELETED: 'license.deleted',
  LICENSE_SEAT_ASSIGNED: 'license.seat_assigned',
  LICENSE_SEAT_REVOKED: 'license.seat_revoked',
  // Assets
  ASSET_CREATED: 'asset.created',
  ASSET_ASSIGNED: 'asset.assigned',
  ASSET_UNASSIGNED: 'asset.unassigned',
  ASSET_RETIRED: 'asset.retired',
  // RBAC
  RBAC_ROLE_CREATED: 'rbac.role_created',
  RBAC_ROLE_PERMISSIONS_UPDATED: 'rbac.role_permissions_updated',
  RBAC_ROLE_DELETED: 'rbac.role_deleted',
  RBAC_ROLE_ASSIGNED: 'rbac.role_assigned',
  RBAC_ROLE_ASSIGNMENT_REVOKED: 'rbac.role_assignment_revoked',
  RBAC_DELEGATION_CREATED: 'rbac.delegation_created',
  RBAC_DELEGATION_REVOKED: 'rbac.delegation_revoked',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
