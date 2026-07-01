/** Domain types for the reports module. */

export interface RequestSummaryRow {
  type: string;
  status: string;
  count: number;
}

export interface CycleTimeRow {
  type: string;
  total: number;
  avgHours: number;
  p50Hours: number;
  p90Hours: number;
}

export interface SlaComplianceRow {
  type: string;
  totalWithSla: number;
  resolved: number;
  withinSla: number;
  breached: number;
  complianceRatePct: number | null;
}

export interface QueueDepthRow {
  type: string;
  pending: number;
  inReview: number;
  atRisk: number;
  total: number;
}

export interface ThroughputPoint {
  day: string;
  submitted: number;
  resolved: number;
}

export interface FindingsSummaryRow {
  severity: string;
  open: number;
  inRemediation: number;
  resolved: number;
  total: number;
}

export interface AssetUtilizationRow {
  type: string;
  inStock: number;
  assigned: number;
  retired: number;
  inRepair: number;
  total: number;
  utilizationPct: number;
}

export interface LeaveSummaryRow {
  leaveType: string;
  status: string;
  count: number;
}

export interface OvertimeSummaryRow {
  status: string;
  count: number;
  totalHours: number;
  avgHours: number;
}
