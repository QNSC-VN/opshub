/**
 * Error codes — machine-readable, surfaced in OpenAPI, used by the FE to branch on `code`.
 * Rules: append-only, never reuse or renumber a deleted code, RESOURCE_REASON convention.
 */
export const ErrorCodes = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_CURSOR: 'INVALID_CURSOR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',

  // Auth / Identity
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  EMPLOYEE_NOT_FOUND: 'EMPLOYEE_NOT_FOUND',
  EMPLOYEE_INACTIVE: 'EMPLOYEE_INACTIVE',

  // Assets
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_TAG_TAKEN: 'ASSET_TAG_TAKEN',
  ASSET_ALREADY_ASSIGNED: 'ASSET_ALREADY_ASSIGNED',
  ASSET_NOT_ASSIGNED: 'ASSET_NOT_ASSIGNED',
  ASSET_RETIRED: 'ASSET_RETIRED',

  // Access requests (temp admin / privileged access)
  ACCESS_REQUEST_NOT_FOUND: 'ACCESS_REQUEST_NOT_FOUND',
  ACCESS_REQUEST_NOT_PENDING: 'ACCESS_REQUEST_NOT_PENDING',
  ACCESS_GRANT_NOT_FOUND: 'ACCESS_GRANT_NOT_FOUND',
  ACCESS_GRANT_NOT_ACTIVE: 'ACCESS_GRANT_NOT_ACTIVE',

  // Compliance
  SOFTWARE_NOT_FOUND: 'SOFTWARE_NOT_FOUND',
  FINDING_NOT_FOUND: 'FINDING_NOT_FOUND',
  FINDING_ALREADY_RESOLVED: 'FINDING_ALREADY_RESOLVED',

  // Workforce
  TIMESHEET_NOT_FOUND: 'TIMESHEET_NOT_FOUND',
  TIMESHEET_NOT_EDITABLE: 'TIMESHEET_NOT_EDITABLE',
  LEAVE_REQUEST_NOT_FOUND: 'LEAVE_REQUEST_NOT_FOUND',
  LEAVE_REQUEST_NOT_PENDING: 'LEAVE_REQUEST_NOT_PENDING',
  LEAVE_OVERLAPPING: 'LEAVE_OVERLAPPING',
  /** Assigning would exceed the position's approved headcount. */
  POSITION_HEADCOUNT_EXCEEDED: 'POSITION_HEADCOUNT_EXCEEDED',
  /** An assignment would end before it began — `ck_employee_position_window` in words. */
  POSITION_INVALID_WINDOW: 'POSITION_INVALID_WINDOW',

  // ── Employment contracts ───────────────────────────────────────────────────
  /** A contract date range runs backwards — `ck_contract_window` and its siblings in words. */
  CONTRACT_INVALID_WINDOW: 'CONTRACT_INVALID_WINDOW',
  /**
   * The type and the end date disagree: `permanent` with an end date, or a fixed engagement
   * without one. `ck_contract_type_end_date` in words.
   */
  CONTRACT_INVALID_TERM: 'CONTRACT_INVALID_TERM',
  /** Only a draft may be edited — an active contract's terms are what somebody signed. */
  CONTRACT_NOT_DRAFT: 'CONTRACT_NOT_DRAFT',
  /** The employee already holds an active contract — `uq_employee_active_contract` in words. */
  CONTRACT_ALREADY_ACTIVE: 'CONTRACT_ALREADY_ACTIVE',
  /** The transition needs an active contract and this one is not. */
  CONTRACT_NOT_ACTIVE: 'CONTRACT_NOT_ACTIVE',
  /** A contract cannot be activated before both parties have signed it. */
  CONTRACT_NOT_SIGNED: 'CONTRACT_NOT_SIGNED',
  /** Activating a contract whose end date has already passed. */
  CONTRACT_ALREADY_ENDED: 'CONTRACT_ALREADY_ENDED',
  /** Requested working days exceed the employee's remaining entitlement (pending included). */
  LEAVE_INSUFFICIENT_BALANCE: 'LEAVE_INSUFFICIENT_BALANCE',
  /** The window contains no working days — every date is a weekend or a public holiday. */
  LEAVE_NO_WORKING_DAYS: 'LEAVE_NO_WORKING_DAYS',
  OVERTIME_NOT_FOUND: 'OVERTIME_NOT_FOUND',
  SHIFT_LOG_NOT_FOUND: 'SHIFT_LOG_NOT_FOUND',

  // Audit
  AUDIT_LOG_NOT_FOUND: 'AUDIT_LOG_NOT_FOUND',

  // Authorization (RBAC)
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  ROLE_KEY_TAKEN: 'ROLE_KEY_TAKEN',
  ROLE_IMMUTABLE: 'ROLE_IMMUTABLE',
  ROLE_ASSIGNMENT_NOT_FOUND: 'ROLE_ASSIGNMENT_NOT_FOUND',
  PERMISSION_NOT_FOUND: 'PERMISSION_NOT_FOUND',

  // Universal Request Engine
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  REQUEST_NOT_PENDING: 'REQUEST_NOT_PENDING',
  REQUEST_NOT_CANCELLABLE: 'REQUEST_NOT_CANCELLABLE',
  REQUEST_SOD_VIOLATION: 'REQUEST_SOD_VIOLATION',

  // Approval Delegation
  DELEGATION_NOT_FOUND: 'DELEGATION_NOT_FOUND',
  DELEGATION_SELF: 'DELEGATION_SELF',
  DELEGATION_INVALID_WINDOW: 'DELEGATION_INVALID_WINDOW',
  DELEGATION_NOT_OWNER: 'DELEGATION_NOT_OWNER',

  // Outbound Webhooks
  WEBHOOK_NOT_FOUND: 'WEBHOOK_NOT_FOUND',
  DELIVERY_NOT_FOUND: 'DELIVERY_NOT_FOUND',

  // Storage / File uploads
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_NOT_UPLOADED: 'FILE_NOT_UPLOADED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_SIZE_MISMATCH: 'FILE_SIZE_MISMATCH',
  /** The stored object's checksum differs from the one declared at presign. */
  FILE_CHECKSUM_MISMATCH: 'FILE_CHECKSUM_MISMATCH',
  /** The owning entity already holds this surface's maximum number of files. */
  ATTACHMENT_LIMIT_EXCEEDED: 'ATTACHMENT_LIMIT_EXCEEDED',
  /** The file exists but is not attached to the entity the caller named. */
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',

  // ── Training ───────────────────────────────────────────────────────────────
  /** A completion date is in the future, behind the live record, or expires before it was earned. */
  TRAINING_INVALID_COMPLETION: 'TRAINING_INVALID_COMPLETION',
  /** Already verified, already revoked, or otherwise not in a state that transition allows. */
  TRAINING_RECORD_NOT_VERIFIABLE: 'TRAINING_RECORD_NOT_VERIFIABLE',

  // ── ISMS risk ──────────────────────────────────────────────────────────────
  /** Residual above inherent, or a factor outside 1..5 — the score CHECKs in words. */
  RISK_INVALID_SCORE: 'RISK_INVALID_SCORE',
  /** The transition needs the risk in a state it is not in. */
  RISK_NOT_IN_STATE: 'RISK_NOT_IN_STATE',
  /** Treatment actions are still open, so the risk cannot be declared treated. */
  RISK_TREATMENT_OUTSTANDING: 'RISK_TREATMENT_OUTSTANDING',
  /** Applicability and implementation status disagree — `ck_soa_applicability` in words. */
  SOA_INCONSISTENT: 'SOA_INCONSISTENT',
  /** The control is retired, so it cannot be newly included in the SoA or linked to a risk. */
  CONTROL_RETIRED: 'CONTROL_RETIRED',
  /** The transition is not legal from the incident's current status. */
  INCIDENT_NOT_IN_STATE: 'INCIDENT_NOT_IN_STATE',
  /** A handling timestamp runs backwards — `ck_incident_timeline_order` in words. */
  INCIDENT_TIMELINE_ORDER: 'INCIDENT_TIMELINE_ORDER',
  /** Resolving needs a root cause; closing needs lessons learned. */
  INCIDENT_EVIDENCE_MISSING: 'INCIDENT_EVIDENCE_MISSING',
  /** Only a personal-data breach has a regulator to notify. */
  INCIDENT_NOT_A_BREACH: 'INCIDENT_NOT_A_BREACH',

  // ── ISMS information assets ────────────────────────────────────────────────
  /** A CIA rating outside 1..5, or a retention period of zero months. */
  INFORMATION_ASSET_INVALID_RATING: 'INFORMATION_ASSET_INVALID_RATING',
  /**
   * The classification label and the confidentiality rating contradict each other —
   * `ck_information_asset_classification_confidentiality` in words.
   */
  INFORMATION_ASSET_CLASSIFICATION_MISMATCH: 'INFORMATION_ASSET_CLASSIFICATION_MISMATCH',
  /** Personal data cannot sit at `public` or `internal`. */
  INFORMATION_ASSET_PERSONAL_DATA_EXPOSED: 'INFORMATION_ASSET_PERSONAL_DATA_EXPOSED',
  /** The asset was not at the level the reclassification started from, or is already at the target. */
  INFORMATION_ASSET_NOT_RECLASSIFIED: 'INFORMATION_ASSET_NOT_RECLASSIFIED',
  /** Lowering a classification is the declassification route, which needs its own permission. */
  INFORMATION_ASSET_DECLASSIFY_REQUIRED: 'INFORMATION_ASSET_DECLASSIFY_REQUIRED',
  /** The asset is retired, so it accepts no new classification, rating or device link. */
  INFORMATION_ASSET_RETIRED: 'INFORMATION_ASSET_RETIRED',

  // ── ISMS vendor risk ───────────────────────────────────────────────────────
  /** The transition is not legal from the vendor's current status. */
  VENDOR_NOT_IN_STATE: 'VENDOR_NOT_IN_STATE',
  /**
   * A vendor cannot go live without a current passing assessment.
   *
   * Not expressible as a CHECK: it is a statement about the LATEST row of another table.
   */
  VENDOR_ASSESSMENT_REQUIRED: 'VENDOR_ASSESSMENT_REQUIRED',
  /** An active data processor needs a recorded agreement — GDPR Article 28(3). */
  VENDOR_AGREEMENT_REQUIRED: 'VENDOR_AGREEMENT_REQUIRED',
  /** The contract window runs backwards — `ck_vendor_contract_window` in words. */
  VENDOR_INVALID_CONTRACT_WINDOW: 'VENDOR_INVALID_CONTRACT_WINDOW',
  /** Conditions missing on a conditional pass, or findings missing on a failure. */
  VENDOR_ASSESSMENT_INCOMPLETE: 'VENDOR_ASSESSMENT_INCOMPLETE',
  /** The relationship has ended, so the record accepts nothing further. */
  VENDOR_TERMINATED: 'VENDOR_TERMINATED',

  // ── QMS non-conformance and CAPA ───────────────────────────────────────────
  /** The transition is not legal from the finding's current status. */
  NONCONFORMANCE_NOT_IN_STATE: 'NONCONFORMANCE_NOT_IN_STATE',
  /**
   * The finding's grade demands a corrective action verified effective before closure.
   *
   * Not expressible as a CHECK: it is a statement about rows in another table.
   */
  NONCONFORMANCE_CAPA_REQUIRED: 'NONCONFORMANCE_CAPA_REQUIRED',
  /** The finding is closed or void, so it accepts nothing further. */
  NONCONFORMANCE_SETTLED: 'NONCONFORMANCE_SETTLED',
  /** The transition is not legal from the CAPA's current status. */
  CAPA_NOT_IN_STATE: 'CAPA_NOT_IN_STATE',
  /** A root cause, the method behind it, and a plan are all required before planning. */
  CAPA_ANALYSIS_INCOMPLETE: 'CAPA_ANALYSIS_INCOMPLETE',
  /** The effectiveness review cannot be signed off by the person who owns the action. */
  CAPA_SELF_VERIFICATION: 'CAPA_SELF_VERIFICATION',
  /** The CAPA is verified or cancelled, so it accepts nothing further. */
  CAPA_SETTLED: 'CAPA_SETTLED',
  /**
   * The effectiveness review cannot be signed by somebody who audited the finding.
   *
   * ISO 9001 §9.2.2(c) — objectivity and impartiality. Distinct from
   * `CAPA_SELF_VERIFICATION`, which is about owning the action rather than having found the problem.
   */
  CAPA_AUDITOR_IMPARTIALITY: 'CAPA_AUDITOR_IMPARTIALITY',

  // ── QMS internal audit ─────────────────────────────────────────────────────
  /** The transition is not legal from the audit's current status. */
  INTERNAL_AUDIT_NOT_IN_STATE: 'INTERNAL_AUDIT_NOT_IN_STATE',
  /** Fieldwork cannot start with nobody rostered to do it. */
  INTERNAL_AUDIT_NO_AUDITORS: 'INTERNAL_AUDIT_NO_AUDITORS',
  /** The audit is closed or cancelled, so it accepts nothing further. */
  INTERNAL_AUDIT_SETTLED: 'INTERNAL_AUDIT_SETTLED',
  /** The planned window runs backwards — `ck_audit_planned_window` in words. */
  INTERNAL_AUDIT_INVALID_WINDOW: 'INTERNAL_AUDIT_INVALID_WINDOW',
  /** The lead auditor is on the roster by construction and cannot be removed from it. */
  INTERNAL_AUDIT_LEAD_REQUIRED: 'INTERNAL_AUDIT_LEAD_REQUIRED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// The error-category taxonomy and its HTTP-status mapping are framework-level
// invariants owned by @qnsc-vn/platform-http. Re-exported here so product code keeps
// importing them from '@platform' while there is a SINGLE source of truth (no drift).
// The product-specific `ErrorCode` catalog above stays local (product policy).
export { type ErrorCategory, CATEGORY_HTTP_STATUS } from '@qnsc-vn/platform-http';
