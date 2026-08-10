import type { incidentEvents, incidents } from '../../../../../db/schema';

export type Incident = typeof incidents.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type IncidentStatus = Incident['status'];
export type IncidentSeverity = Incident['severity'];
export type IncidentEventType = IncidentEvent['type'];

export interface ReportIncidentInput {
  reference: string;
  title: string;
  description: string;
  category: string;
  severity: IncidentSeverity;
  /** When it was DETECTED. Every deadline counts from here, not from when the form was filled. */
  detectedAt: string;
  assetId?: string | null;
  riskId?: string | null;
  personalDataBreach?: boolean;
}

/**
 * What may still be corrected while handling continues.
 *
 * `detectedAt` is included because a reporter's first guess at the detection time is often wrong and
 * the 72-hour clock depends on it. `reference` is not: it is quoted in regulator correspondence.
 */
export type UpdateIncidentInput = Partial<{
  title: string;
  description: string;
  category: string;
  severity: IncidentSeverity;
  detectedAt: string;
  assetId: string | null;
  riskId: string | null;
  personalDataBreach: boolean;
}>;

export interface IncidentFilters {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  category?: string;
  assignedTo?: string;
  riskId?: string;
  /** Everything not yet closed or dismissed — the response queue. */
  openOnly?: boolean;
  /** Personal-data breaches only. */
  breachesOnly?: boolean;
}

export interface RecordEventInput {
  type: IncidentEventType;
  detail: string;
  /** When the described thing happened, which may precede when it was written down. */
  occurredAt?: string;
}

/**
 * A breach whose 72-hour regulator deadline has passed with no notification recorded.
 *
 * `hoursOverdue` is computed in SQL alongside the row: the deadline is derived from `detected_at`,
 * and having the query say by how much removes any second calculation on the way to a screen.
 */
export interface OverdueBreach {
  id: string;
  reference: string;
  title: string;
  severity: IncidentSeverity;
  detectedAt: Date;
  notificationDueAt: Date;
  hoursOverdue: number;
}
