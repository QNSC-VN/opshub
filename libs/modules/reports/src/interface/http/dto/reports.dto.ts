import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Query params ─────────────────────────────────────────────────────────────

const DateRangeQuerySchema = z.object({
  /** ISO-8601 start date/time. Defaults to 30 days ago. */
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO-8601 start (inclusive). Defaults to 30 days ago.'),
  /** ISO-8601 end date/time. Defaults to now. */
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO-8601 end (inclusive). Defaults to now.'),
  /** Filter to a specific request type (e.g. "access_request"). */
  type: z.string().min(1).max(100).optional(),
});

export class DateRangeQueryDto extends createZodDto(DateRangeQuerySchema) {}

const DateRangeOnlyQuerySchema = DateRangeQuerySchema.omit({ type: true });
export class DateRangeOnlyQueryDto extends createZodDto(DateRangeOnlyQuerySchema) {}

// ─── Request reports ──────────────────────────────────────────────────────────

const RequestSummaryItemSchema = z.object({
  type: z.string(),
  status: z.string(),
  count: z.number().int(),
});
export class RequestSummaryItemDto extends createZodDto(RequestSummaryItemSchema) {}

const RequestSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(RequestSummaryItemSchema),
});
export class RequestSummaryResponseDto extends createZodDto(RequestSummaryResponseSchema) {}

const CycleTimeItemSchema = z.object({
  type: z.string(),
  total: z.number().int(),
  avgHours: z.number(),
  p50Hours: z.number(),
  p90Hours: z.number(),
});
const CycleTimeResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(CycleTimeItemSchema),
});
export class CycleTimeResponseDto extends createZodDto(CycleTimeResponseSchema) {}

const SlaComplianceItemSchema = z.object({
  type: z.string(),
  totalWithSla: z.number().int(),
  resolved: z.number().int(),
  withinSla: z.number().int(),
  breached: z.number().int(),
  complianceRatePct: z.number().nullable(),
});
const SlaComplianceResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(SlaComplianceItemSchema),
});
export class SlaComplianceResponseDto extends createZodDto(SlaComplianceResponseSchema) {}

const QueueDepthItemSchema = z.object({
  type: z.string(),
  pending: z.number().int(),
  inReview: z.number().int(),
  atRisk: z.number().int(),
  total: z.number().int(),
});
const QueueDepthResponseSchema = z.object({
  asOf: z.string(),
  rows: z.array(QueueDepthItemSchema),
});
export class QueueDepthResponseDto extends createZodDto(QueueDepthResponseSchema) {}

const ThroughputPointSchema = z.object({
  day: z.string(),
  submitted: z.number().int(),
  resolved: z.number().int(),
});
const ThroughputResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  points: z.array(ThroughputPointSchema),
});
export class ThroughputResponseDto extends createZodDto(ThroughputResponseSchema) {}

// ─── Compliance reports ───────────────────────────────────────────────────────

const FindingsSummaryItemSchema = z.object({
  severity: z.string(),
  open: z.number().int(),
  /** Count of acknowledged / in-remediation findings. */
  inRemediation: z.number().int(),
  resolved: z.number().int(),
  total: z.number().int(),
});
const FindingsSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(FindingsSummaryItemSchema),
});
export class FindingsSummaryResponseDto extends createZodDto(FindingsSummaryResponseSchema) {}

// ─── Assets reports ───────────────────────────────────────────────────────────

const AssetUtilizationItemSchema = z.object({
  type: z.string(),
  inStock: z.number().int(),
  assigned: z.number().int(),
  retired: z.number().int(),
  inRepair: z.number().int(),
  total: z.number().int(),
  utilizationPct: z.number(),
});
const AssetUtilizationResponseSchema = z.object({
  asOf: z.string(),
  rows: z.array(AssetUtilizationItemSchema),
});
export class AssetUtilizationResponseDto extends createZodDto(AssetUtilizationResponseSchema) {}

// ─── Workforce reports ────────────────────────────────────────────────────────

const LeaveSummaryItemSchema = z.object({
  leaveType: z.string(),
  status: z.string(),
  count: z.number().int(),
});
const LeaveSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(LeaveSummaryItemSchema),
});
export class LeaveSummaryResponseDto extends createZodDto(LeaveSummaryResponseSchema) {}

const OvertimeSummaryItemSchema = z.object({
  status: z.string(),
  count: z.number().int(),
  totalHours: z.number(),
  avgHours: z.number(),
});
const OvertimeSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(OvertimeSummaryItemSchema),
});
export class OvertimeSummaryResponseDto extends createZodDto(OvertimeSummaryResponseSchema) {}
