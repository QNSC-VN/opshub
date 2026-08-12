import type { components } from '@/shared/api/generated/api';

/**
 * The internal-audit vocabulary, from the generated spec.
 */

export type InternalAudit = components['schemas']['InternalAuditRowResponseDto'];
export type AuditAuditor = components['schemas']['AuditAuditorResponseDto'];
export type AuditFinding = components['schemas']['AuditFindingResponseDto'];
export type UnlinkedFinding = components['schemas']['UnlinkedFindingResponseDto'];

/**
 * The audit lifecycle: planned → in_progress → reported → closed, with `cancelled` off to one side.
 *
 * `in_progress → closed` IS NOT LEGAL, in the service and in `ck_audit_reported_pair`. ISO 9001 §9.2.2(d)
 * makes reporting results its own obligation: an audit whose fieldwork finished and whose results never
 * reached anybody has not been done, whatever a status column says. And `cancelled` is unreachable from
 * `reported` — once results are out, the audit happened, and the record of it is not cancellable.
 */
export const AUDIT_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'Fieldwork' },
  { value: 'reported', label: 'Reported' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/** Which action each audit state allows, mirroring the service's transition map. */
export const AUDIT_NEXT_ACTIONS: Record<
  string,
  readonly ('start' | 'report' | 'close' | 'cancel')[]
> = {
  planned: ['start', 'cancel'],
  in_progress: ['report', 'cancel'],
  reported: ['close'],
  closed: [],
  cancelled: [],
};

/**
 * The roster roles.
 *
 * `observer` is not a spare label: the roster is what the impartiality rule reads, and anybody on it —
 * observers included — is somebody who audited the engagement and therefore cannot later certify that a
 * corrective action for one of its findings worked (`CAPA_AUDITOR_IMPARTIALITY`).
 */
export const AUDIT_ROLES = ['lead', 'auditor', 'observer'] as const;
