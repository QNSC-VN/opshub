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

/**
 * ISO 27002:2022 groups controls into four THEMES, replacing the 14 clauses of the 2013 edition.
 *
 * Stored as an enum rather than free text because the four are fixed by the standard and every SoA
 * export groups by them; a typo'd theme silently splits a section of the report in two.
 */
export const controlThemeEnum = pgEnum('control_theme', [
  'organizational',
  'people',
  'physical',
  'technological',
]);

/**
 * Where a control came from.
 *
 * `annex_a` controls are the standard's; `custom` ones are the organisation's own additions, which
 * ISO 27001 explicitly permits — the SoA has to state that Annex A was compared against, not that
 * nothing else exists.
 */
export const controlSourceEnum = pgEnum('control_source', ['annex_a', 'custom']);

/**
 * How far a control has actually been put in place.
 *
 * `not_applicable` is a status rather than a separate flag so the two cannot disagree: it is paired
 * with `applicable = false` by `ck_soa_applicability`, which means "excluded but implemented" is
 * unrepresentable.
 */
export const controlImplementationStatusEnum = pgEnum('control_implementation_status', [
  'not_applicable',
  'not_implemented',
  'partially_implemented',
  'implemented',
]);

/**
 * Where a security incident is in its handling.
 *
 * The order is the ISO 27035 sequence and it is one-way: `reported` → `triaged` → `contained` →
 * `resolved` → `closed`. A separate `false_positive` terminal state exists because "it turned out
 * not to be an incident" is a real outcome, and forcing it through `contained`/`resolved` would put
 * containment timestamps on something that never needed containing.
 */
export const incidentStatusEnum = pgEnum('incident_status', [
  'reported',
  'triaged',
  'contained',
  'resolved',
  'closed',
  'false_positive',
]);

/**
 * How bad it is. Named bands rather than 1..5 because an incident severity drives a RESPONSE
 * (who is woken up, what the deadline is), and a number invites arithmetic that means nothing.
 */
export const incidentSeverityEnum = pgEnum('incident_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

/**
 * What kind of entry a timeline row is.
 *
 * The timeline is append-only, so the type is how a reader distinguishes an automatic state change
 * from something a responder wrote.
 */
export const incidentEventTypeEnum = pgEnum('incident_event_type', [
  'status_change',
  'note',
  'evidence',
  'notification',
]);

// ── ISMS information assets ──────────────────────────────────────────────────
/**
 * The classification labels, in order of increasing protection.
 *
 * The ORDER OF THESE VALUES IS NOT THE RANKING. Postgres orders an enum by declaration order, so it
 * happens to agree today, but nothing keeps them in step: inserting a new label in the middle needs
 * `ALTER TYPE ... BEFORE`, and anybody appending one at the end would silently make it the highest.
 * The authoritative ranking is the `rank` column on `isms.classification_levels`, which is also
 * where the handling rules live — see that table.
 */
export const informationClassificationEnum = pgEnum('information_classification', [
  'public',
  'internal',
  'confidential',
  'restricted',
]);

/**
 * What kind of thing the information asset IS.
 *
 * Deliberately not the same list as `asset_type`, which enumerates devices (laptop, monitor, phone).
 * An information asset is the information and the thing that holds it — a payroll system, a customer
 * database, a room of signed contracts — and a device is a CONTAINER for one, linked through
 * `isms.information_asset_devices` rather than conflated with it.
 */
export const informationAssetTypeEnum = pgEnum('information_asset_type', [
  'system',
  'application',
  'database',
  'dataset',
  'repository',
  'document_set',
  'physical_record',
  'service',
  'other',
]);
