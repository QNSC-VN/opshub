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

/**
 * Which management system a controlled document belongs to.
 *
 * The ONLY thing distinguishing a policy from an SOP from a handbook — everything else about their
 * lifecycle is identical, which is why they share one table rather than three.
 */
export const documentCategoryEnum = pgEnum('document_category', [
  'isms_policy',
  'qms_procedure',
  'work_instruction',
  'hr_handbook',
  'contract_template',
]);

/**
 * Lifecycle of one document VERSION.
 *
 * `published` is terminal-ish: the row becomes immutable and only `superseded` follows, because a
 * published revision is what someone was told to follow on a given date. Editing means a new
 * version, never a status walk backwards.
 */
export const documentVersionStatusEnum = pgEnum('document_version_status', [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
  'rejected',
]);

/**
 * Lifecycle of a job position.
 *
 * `frozen` is the state a hiring pause needs and a boolean cannot express: the position still
 * exists and its occupants keep it, but no new assignment may be made against it.
 */
export const positionStatusEnum = pgEnum('position_status', ['active', 'frozen', 'closed']);

/**
 * Kind of employment agreement.
 *
 * Drives whether an end date is REQUIRED or FORBIDDEN, which is a database CHECK rather than a
 * service convention: `permanent` with an end date is a fixed-term contract mislabelled, and a
 * `fixed_term` without one is an open-ended contract nobody approved.
 */
export const contractTypeEnum = pgEnum('contract_type', [
  'permanent',
  'fixed_term',
  'probation',
  'internship',
  'contractor',
]);

/**
 * Lifecycle of an employment contract.
 *
 * `draft` exists because a contract is negotiated before it binds anyone, and only `active`
 * competes for the one-per-employee slot. `expired` is reached by the passage of time and written
 * by the sweep; `terminated` is a decision somebody made and carries a reason.
 */
export const contractStatusEnum = pgEnum('contract_status', [
  'draft',
  'active',
  'expired',
  'terminated',
]);

/** What the base salary figure is PER — a number without this is not an amount. */
export const salaryPeriodEnum = pgEnum('salary_period', ['hourly', 'monthly', 'annual']);

/**
 * Whether a completed training still counts.
 *
 * `valid` and `expired` are the two real states; `expiring_soon` is NOT one of them — it is a
 * question about today's date relative to `expires_on`, so it is computed on read rather than
 * stored, and no sweep has to keep it true. Compare `contract_status`, where the sweep exists
 * because an expiry there changes what may happen next.
 */
export const trainingRecordStatusEnum = pgEnum('training_record_status', [
  'valid',
  'expired',
  'revoked',
]);

/** How a course requirement applies — the QMS competency distinction. */
export const trainingRequirementKindEnum = pgEnum('training_requirement_kind', [
  'mandatory',
  'recommended',
]);

/**
 * Where a risk is in its lifecycle.
 *
 * `assessed` means scored but untreated; `treated` means the treatment plan is complete and a
 * residual score has been recorded; `accepted` means somebody with authority chose to carry it.
 * `closed` is terminal — the risk no longer applies (the asset was retired, the process changed).
 *
 * There is deliberately no `expiring` state: "due for review" is a question about `review_due_on`
 * against today, so it is computed rather than stored. Compare `contract_status`, where the sweep
 * exists because an expiry there changes what may happen next.
 */
export const riskStatusEnum = pgEnum('risk_status', [
  'identified',
  'assessed',
  'treated',
  'accepted',
  'closed',
]);

/** The four ISO 27005 treatment options. Naming them exactly keeps an audit conversation short. */
export const riskTreatmentDecisionEnum = pgEnum('risk_treatment_decision', [
  'mitigate',
  'accept',
  'transfer',
  'avoid',
]);

/** Lifecycle of one action within a treatment plan. */
export const riskTreatmentStatusEnum = pgEnum('risk_treatment_status', [
  'planned',
  'in_progress',
  'done',
  'cancelled',
]);
