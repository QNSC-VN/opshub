import type { internalAuditAuditors, internalAudits } from '../../../../../db/schema';
import type { NonconformanceSeverity } from './qms.types';

export type InternalAudit = typeof internalAudits.$inferSelect;
export type InternalAuditAuditor = typeof internalAuditAuditors.$inferSelect;
export type InternalAuditStatus = InternalAudit['status'];
export type AuditRole = InternalAuditAuditor['role'];

export interface PlanAuditInput {
  reference: string;
  title: string;
  objective: string;
  /** Which processes, sites and periods it covers — §9.2.2(b). */
  scope: string;
  /** The requirements audited AGAINST. Not the same question as scope. */
  criteria: string;
  leadAuditorId: string;
  plannedStartOn?: string | null;
  plannedEndOn?: string | null;
}

/**
 * What may be corrected while the audit is still planned or running.
 *
 * `status` and every state timestamp are absent: those belong to the lifecycle methods, which check
 * preconditions a patch would bypass — reporting through a PATCH would skip the conclusion
 * requirement entirely. `leadAuditorId` IS here, because a lead changing before fieldwork is
 * ordinary; the service keeps the roster in step with it.
 */
export type UpdateAuditInput = Partial<{
  title: string;
  objective: string;
  scope: string;
  criteria: string;
  leadAuditorId: string;
  plannedStartOn: string | null;
  plannedEndOn: string | null;
}>;

export interface InternalAuditFilters {
  status?: InternalAuditStatus;
  leadAuditorId?: string;
  /** Anybody on the roster, in any role — "which audits was I on". */
  auditorId?: string;
  /** Everything not closed or cancelled — the programme's live work. */
  openOnly?: boolean;
  /** Planned to start on or before this date. Today's date gives the overdue programme. */
  plannedStartOnOrBefore?: string;
  search?: string;
}

/** An audit row with its roster size and its findings, resolved in one query. */
export interface InternalAuditRow extends InternalAudit {
  /** People in `lead` or `auditor` roles. Observers are excluded — they did not audit. */
  auditorCount: number;
  /** Findings raised against this audit, and how many are still open. */
  findingCount: number;
  openFindingCount: number;
}

/** A finding raised by an audit, with the grade a reader needs to triage it. */
export interface AuditFinding {
  id: string;
  reference: string;
  title: string;
  severity: NonconformanceSeverity;
  severityRank: number;
  status: string;
  ownerId: string;
  detectedAt: Date;
}

/**
 * An `internal_audit` finding that names no audit.
 *
 * The gap the nullable column leaves open, surfaced as a report rather than forced as a constraint —
 * the same shape as the risk register's unlinked incidents and the vendor register's unassessed
 * spend. A finding recorded during fieldwork before the engagement row exists is ordinary; one that
 * is still unlinked a month later is a traceability hole in the audit programme.
 */
export interface UnlinkedFinding {
  id: string;
  reference: string;
  title: string;
  severity: NonconformanceSeverity;
  processArea: string;
  detectedAt: Date;
  raisedBy: string;
}
