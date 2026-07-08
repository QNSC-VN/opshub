/**
 * Shared enums (Postgres enum types). Imported by table definitions — keep first.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// ── Identity ─────────────────────────────────────────────────────────────────
export const employeeStatusEnum = pgEnum('employee_status', ['active', 'on_leave', 'offboarded']);

// ── Authorization (RBAC scopes) ──────────────────────────────────────────────
export const scopeTypeEnum = pgEnum('scope_type', ['global', 'self', 'team', 'dept', 'region']);

// ── Universal Request Engine ─────────────────────────────────────────────────
export const requestStatusEnum = pgEnum('request_status', [
  'pending',
  'in_review',
  'approved',
  'rejected',
  'cancelled',
  'expired',
]);
export const requestPriorityEnum = pgEnum('request_priority', ['low', 'normal', 'high', 'urgent']);

// ── Assets ───────────────────────────────────────────────────────────────────
export const assetTypeEnum = pgEnum('asset_type', [
  'laptop',
  'desktop',
  'monitor',
  'phone',
  'tablet',
  'peripheral',
  'other',
]);
export const assetStatusEnum = pgEnum('asset_status', [
  'in_stock',
  'assigned',
  'in_repair',
  'retired',
  'lost',
]);

// ── Access requests (privileged / temp-admin) ────────────────────────────────
export const accessRequestStatusEnum = pgEnum('access_request_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
  'revoked',
]);
export const accessTypeEnum = pgEnum('access_type', [
  'local_admin',
  'pim_role',
  'app_admin',
  'vpn',
  'other',
]);

// ── Compliance ───────────────────────────────────────────────────────────────
export const findingStatusEnum = pgEnum('finding_status', [
  'open',
  'acknowledged',
  'resolved',
  'risk_accepted',
]);
export const findingSeverityEnum = pgEnum('finding_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);
export const softwareListingEnum = pgEnum('software_listing', [
  'whitelisted',
  'blacklisted',
  'review',
]);

// ── Workforce ────────────────────────────────────────────────────────────────
export const timesheetStatusEnum = pgEnum('timesheet_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);
export const leaveTypeEnum = pgEnum('leave_type', [
  'annual',
  'sick',
  'unpaid',
  'parental',
  'other',
]);
export const leaveStatusEnum = pgEnum('leave_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);
export const overtimeStatusEnum = pgEnum('overtime_status', ['pending', 'approved', 'rejected']);
export const shiftTypeEnum = pgEnum('shift_type', ['night', 'on_call', 'weekend']);

// ── Storage ──────────────────────────────────────────────────────────────────
export const storedFileStatusEnum = pgEnum('stored_file_status', [
  'pending',
  'completed',
  'deleted',
]);

// ── License ───────────────────────────────────────────────────────────────────
// Value sets taken from the existing DTO Zod enums (the code-authoritative
// source), in libs/modules/license/src/interface/http/dto/license.dto.ts:
//   licenseTypeZ   = z.enum(['perpetual','subscription','per_seat','concurrent'])
//   licenseStatusZ = z.enum(['active','expiring_soon','expired','cancelled'])
// Schema must match the DTO so validated input round-trips to the column.
// Defaults in licenses.ts (license_type='subscription', status='active') are in-set.
export const licenseTypeEnum = pgEnum('license_type', [
  'perpetual',
  'subscription',
  'per_seat',
  'concurrent',
]);
export const licenseStatusEnum = pgEnum('license_status', [
  'active',
  'expiring_soon',
  'expired',
  'cancelled',
]);

export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'sent', 'failed', 'delivered']);

export const requestDecisionEnum = pgEnum('request_decision', [
  'approved',
  'rejected',
  'delegated',
]);

export const baselineCheckCategoryEnum = pgEnum('baseline_check_category', [
  'asr',
  'firewall',
  'encryption',
  'endpoint',
  'identity',
  'other',
]);

export const baselineCheckStatusEnum = pgEnum('baseline_check_status', [
  'pass',
  'fail',
  'warning',
  'not_applicable',
]);
