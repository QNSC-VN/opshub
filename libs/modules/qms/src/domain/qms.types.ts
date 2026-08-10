import type { capas, nonconformances, nonconformanceSeverities } from '../../../../../db/schema';

export type Nonconformance = typeof nonconformances.$inferSelect;
export type Capa = typeof capas.$inferSelect;
export type NonconformanceSeverityLevel = typeof nonconformanceSeverities.$inferSelect;
export type NonconformanceSeverity = Nonconformance['severity'];
export type NonconformanceStatus = Nonconformance['status'];
export type NonconformanceSource = Nonconformance['source'];
export type CapaStatus = Capa['status'];
export type CapaRootCauseMethod = NonNullable<Capa['rootCauseMethod']>;

// ── Non-conformances ─────────────────────────────────────────────────────────

export interface RaiseNonconformanceInput {
  reference: string;
  title: string;
  description: string;
  /** The clause, procedure or specification that was not met. */
  requirement: string;
  source: NonconformanceSource;
  severity: NonconformanceSeverity;
  processArea: string;
  ownerId: string;
  /** When it was found — not when the form was filled in. Every deadline counts from here. */
  detectedAt?: string;
  /** The security incident this finding also describes, when there is one. */
  incidentId?: string | null;
  /**
   * The internal audit that raised it, when one did.
   *
   * Settable at raise time and by patch, because the engagement row often does not exist yet when a
   * finding is written up during fieldwork. Findings that claim an internal-audit source and never
   * get linked surface on `GET /internal-audits/reports/unlinked-findings`.
   */
  internalAuditId?: string | null;
  evidenceDocumentId?: string | null;
}

/**
 * What may be corrected while the finding is open.
 *
 * `status` and every state timestamp are absent: those belong to the lifecycle methods, which check
 * preconditions a patch would bypass — closing through a PATCH would skip the CAPA gate entirely.
 * `severity` IS here, because re-grading a finding on better information is ordinary work; the gate
 * then reads the new grade, which is the point.
 */
export type UpdateNonconformanceInput = Partial<{
  title: string;
  description: string;
  requirement: string;
  source: NonconformanceSource;
  severity: NonconformanceSeverity;
  processArea: string;
  ownerId: string;
  detectedAt: string;
  incidentId: string | null;
  internalAuditId: string | null;
  evidenceDocumentId: string | null;
}>;

export interface NonconformanceFilters {
  status?: NonconformanceStatus;
  severity?: NonconformanceSeverity;
  source?: NonconformanceSource;
  ownerId?: string;
  processArea?: string;
  /** Everything not closed or void — the work queue. */
  openOnly?: boolean;
  /** Only findings whose grade makes a CAPA mandatory. */
  capaRequiredOnly?: boolean;
  search?: string;
}

/** A register row with its grade's policy and its CAPA counts, resolved in one query. */
export interface NonconformanceRow extends Nonconformance {
  severityRank: number;
  requiresCapa: boolean;
  containmentDueDays: number;
  /** How many CAPAs exist against it, and how many have been verified effective. */
  capaCount: number;
  verifiedCapaCount: number;
  /** `detected_at + the grade's containment days`, as `YYYY-MM-DD`. Null once contained. */
  containmentDueOn: string | null;
}

// ── CAPAs ────────────────────────────────────────────────────────────────────

export interface OpenCapaInput {
  reference: string;
  ownerId: string;
  dueOn?: string | null;
}

/**
 * The analysis, supplied before the CAPA may be planned.
 *
 * Both fields together: a cause with no method behind it is an assertion, and recording the method
 * is what makes it reviewable.
 */
export interface CapaAnalysisInput {
  rootCause: string;
  rootCauseMethod: CapaRootCauseMethod;
  actionPlan: string;
  dueOn?: string | null;
}

export interface CapaFilters {
  status?: CapaStatus;
  ownerId?: string;
  nonconformanceId?: string;
  /** Everything not verified or cancelled — the work queue. */
  openOnly?: boolean;
  /** Due on or before this date. Today's date gives the overdue report. */
  dueOnOrBefore?: string;
}

/** A CAPA with the finding it answers, so a list does not need a second round trip. */
export interface CapaRow extends Capa {
  nonconformanceReference: string;
  nonconformanceTitle: string;
  nonconformanceSeverity: NonconformanceSeverity;
}

// ── Reports ──────────────────────────────────────────────────────────────────

/**
 * A finding past the containment deadline its grade allows.
 *
 * `dueOn` and `daysOverdue` are derived in SQL from `detected_at` and the grade's
 * `containment_due_days`, so nothing downstream recomputes them.
 */
export interface ContainmentOverdue {
  id: string;
  reference: string;
  title: string;
  severity: NonconformanceSeverity;
  severityRank: number;
  processArea: string;
  ownerId: string;
  detectedAt: Date;
  dueOn: string;
  daysOverdue: number;
}

/**
 * A process area where findings keep recurring DESPITE a verified corrective action.
 *
 * The report ISO 9001 §10.2(d) exists for: an area with a CAPA already verified effective and a
 * later finding against it is evidence the review was wrong. Nothing else in the system can say
 * that, because it needs the dates of both.
 */
export interface RecurrenceSignal {
  processArea: string;
  findings: number;
  verifiedCapas: number;
  /** The most recent finding raised AFTER a CAPA in that area was verified. */
  latestReference: string;
  latestDetectedAt: Date;
  /** When the CAPA that should have prevented it was verified. */
  earlierCapaVerifiedAt: Date;
}
