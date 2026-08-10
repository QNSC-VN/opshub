import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import {
  capaRootCauseMethodEnum,
  capaStatusEnum,
  nonconformanceSeverityEnum,
  nonconformanceSourceEnum,
  nonconformanceStatusEnum,
} from '@db/schema/enums';

const severity = z.enum(nonconformanceSeverityEnum.enumValues);
const source = z.enum(nonconformanceSourceEnum.enumValues);
const ncStatus = z.enum(nonconformanceStatusEnum.enumValues);
const capaStatus = z.enum(capaStatusEnum.enumValues);
const rootCauseMethod = z.enum(capaRootCauseMethodEnum.enumValues);

/** 10 characters minimum, matching the substance CHECKs and the services' refusals. */
const substantial = z.string().min(10).max(5000);

/** A reference quoted in audit reports. Uppercase so it reads the same everywhere it is cited. */
const reference = (example: string) =>
  z
    .string()
    .min(3)
    .max(40)
    .regex(
      /^[A-Z][A-Z0-9.-]*$/,
      `Use uppercase letters, digits, dots and hyphens, e.g. ${example}`,
    );

export const RaiseNonconformanceSchema = z.object({
  reference: reference('NC-2026-014'),
  title: z.string().min(5).max(200),
  description: substantial,
  /** The clause, procedure or specification that was not met. */
  requirement: z.string().min(5).max(2000),
  source,
  severity,
  processArea: z.string().min(2).max(120),
  ownerId: z.string().uuid(),
  /** When it was FOUND. Every containment deadline counts from here, not from the form. */
  detectedAt: z.string().datetime().optional(),
  /** The security incident this finding also describes, when there is one. */
  incidentId: z.string().uuid().nullable().optional(),
  evidenceDocumentId: z.string().uuid().nullable().optional(),
});
export class RaiseNonconformanceDto extends createZodDto(RaiseNonconformanceSchema) {}

/**
 * `status` and every state timestamp are absent DELIBERATELY.
 *
 * Those belong to the lifecycle routes, which check preconditions a patch would bypass — closing
 * through a PATCH would skip the CAPA gate entirely. `severity` IS settable: re-grading on better
 * information is ordinary work, and the gate then reads the new grade.
 */
export const UpdateNonconformanceSchema = RaiseNonconformanceSchema.omit({ reference: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Supply at least one field to update');
export class UpdateNonconformanceDto extends createZodDto(UpdateNonconformanceSchema) {}

export const ContainNonconformanceSchema = z.object({
  /** The immediate fix. Required by `ck_nc_contained_pair`. */
  containmentAction: substantial,
  /** When it was contained. Defaults to now; supplied when writing up after the fact. */
  containedAt: z.string().datetime().optional(),
});
export class ContainNonconformanceDto extends createZodDto(ContainNonconformanceSchema) {}

export const CloseNonconformanceSchema = z.object({
  /** Why it can be closed. Required by `ck_nc_closed_pair`. */
  closureNote: substantial,
});
export class CloseNonconformanceDto extends createZodDto(CloseNonconformanceSchema) {}

export const VoidNonconformanceSchema = z.object({
  /** Why it was raised in error. Required by `ck_nc_void_clean`. */
  reason: substantial,
});
export class VoidNonconformanceDto extends createZodDto(VoidNonconformanceSchema) {}

export const ListNonconformancesQuerySchema = z
  .object({
    status: ncStatus.optional(),
    severity: severity.optional(),
    source: source.optional(),
    ownerId: z.string().uuid().optional(),
    processArea: z.string().max(120).optional(),
    /** Everything not closed or void — the work queue. */
    openOnly: z.coerce.boolean().optional(),
    /** Only grades whose policy makes a corrective action mandatory. */
    capaRequiredOnly: z.coerce.boolean().optional(),
    search: z.string().max(200).optional(),
  })
  .merge(PaginationQuerySchema);
export class ListNonconformancesQueryDto extends createZodDto(ListNonconformancesQuerySchema) {}

// ── CAPAs ─────────────────────────────────────────────────────────────────────

export const OpenCapaSchema = z.object({
  reference: reference('CAPA-2026-007'),
  ownerId: z.string().uuid(),
  dueOn: z.string().date().nullable().optional(),
});
export class OpenCapaDto extends createZodDto(OpenCapaSchema) {}

export const CapaAnalysisSchema = z.object({
  /** Why it happened. Required before the CAPA may be planned. */
  rootCause: substantial,
  /** How that was established — "we thought about it" is not a method. */
  rootCauseMethod,
  /** What will be done. Required before the CAPA may be planned. */
  actionPlan: substantial,
  dueOn: z.string().date().nullable().optional(),
});
export class CapaAnalysisDto extends createZodDto(CapaAnalysisSchema) {}

export const MarkImplementedSchema = z.object({
  /** When the actions were completed. Defaults to now. */
  implementedAt: z.string().datetime().optional(),
});
export class MarkImplementedDto extends createZodDto(MarkImplementedSchema) {}

export const VerifyCapaSchema = z.object({
  /** What was checked, and what it showed. Required by `ck_capa_verified_pair`. */
  effectivenessEvidence: substantial,
});
export class VerifyCapaDto extends createZodDto(VerifyCapaSchema) {}

export const CapaOutcomeSchema = z.object({
  /** Why the review failed, or why the CAPA was cancelled. Required by `ck_capa_outcome_note`. */
  reason: substantial,
});
export class CapaOutcomeDto extends createZodDto(CapaOutcomeSchema) {}

export const ListCapasQuerySchema = z
  .object({
    status: capaStatus.optional(),
    ownerId: z.string().uuid().optional(),
    nonconformanceId: z.string().uuid().optional(),
    /** Everything not verified or cancelled — the work queue. */
    openOnly: z.coerce.boolean().optional(),
    /** Due on or before this date. Today's date gives the overdue report. */
    dueOnOrBefore: z.string().date().optional(),
  })
  .merge(PaginationQuerySchema);
export class ListCapasQueryDto extends createZodDto(ListCapasQuerySchema) {}

// ── Responses ─────────────────────────────────────────────────────────────────

export class NonconformanceSeverityResponseDto {
  code!: string;
  /** Higher is worse. THE ordering — the enum's declaration order is not authoritative. */
  rank!: number;
  label!: string;
  description!: string;
  /** Whether closing at this grade requires a corrective action verified effective. */
  requiresCapa!: boolean;
  containmentDueDays!: number;
}

export class NonconformanceResponseDto {
  id!: string;
  reference!: string;
  title!: string;
  description!: string;
  requirement!: string;
  source!: string;
  severity!: string;
  status!: string;
  processArea!: string;
  ownerId!: string;
  detectedAt!: string;
  raisedBy!: string;
  incidentId!: string | null;
  evidenceDocumentId!: string | null;
  containmentAction!: string | null;
  containedAt!: string | null;
  closedAt!: string | null;
  closureNote!: string | null;
  closedBy!: string | null;
  voidReason!: string | null;
  createdAt!: string;
}

export class NonconformanceRowResponseDto extends NonconformanceResponseDto {
  /** Resolved from `qms.nonconformance_severities` in the same query as the row. */
  severityRank!: number;
  requiresCapa!: boolean;
  containmentDueDays!: number;
  capaCount!: number;
  verifiedCapaCount!: number;
  /** `detectedAt + containmentDueDays`. Null once contained — a met deadline is not a deadline. */
  containmentDueOn!: string | null;
}

export class CapaResponseDto {
  id!: string;
  reference!: string;
  nonconformanceId!: string;
  status!: string;
  ownerId!: string;
  rootCause!: string | null;
  rootCauseMethod!: string | null;
  actionPlan!: string | null;
  dueOn!: string | null;
  implementedAt!: string | null;
  verifiedAt!: string | null;
  verifiedBy!: string | null;
  effectivenessEvidence!: string | null;
  outcomeNote!: string | null;
  createdAt!: string;
}

export class CapaRowResponseDto extends CapaResponseDto {
  nonconformanceReference!: string;
  nonconformanceTitle!: string;
  nonconformanceSeverity!: string;
}

export class ContainmentOverdueResponseDto {
  id!: string;
  reference!: string;
  title!: string;
  severity!: string;
  severityRank!: number;
  processArea!: string;
  ownerId!: string;
  detectedAt!: string;
  dueOn!: string;
  daysOverdue!: number;
}

export class RecurrenceSignalResponseDto {
  processArea!: string;
  findings!: number;
  verifiedCapas!: number;
  /** The most recent finding raised AFTER a CAPA in that area was verified effective. */
  latestReference!: string;
  latestDetectedAt!: string;
  /** When the CAPA that should have prevented it was signed off. */
  earlierCapaVerifiedAt!: string;
}
