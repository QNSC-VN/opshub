import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { incidentEventTypeEnum, incidentSeverityEnum, incidentStatusEnum } from '@db/schema/enums';

const severity = z.enum(incidentSeverityEnum.enumValues);
const status = z.enum(incidentStatusEnum.enumValues);
const eventType = z.enum(incidentEventTypeEnum.enumValues);

/** 10 characters minimum, matching the evidence CHECKs and the service's refusals. */
const evidence = z.string().min(10).max(5000);

export const ReportIncidentSchema = z.object({
  /** Quoted in the post-incident report and any regulator correspondence. */
  reference: z
    .string()
    .min(3)
    .max(40)
    .regex(
      /^[A-Z][A-Z0-9.-]*$/,
      'Use uppercase letters, digits, dots and hyphens, e.g. INC-2026-004',
    ),
  title: z.string().min(3).max(200),
  description: evidence,
  category: z.string().min(2).max(64),
  severity,
  /** When it was DETECTED. Every deadline counts from here — including the GDPR 72 hours. */
  detectedAt: z.string().datetime(),
  assetId: z.string().uuid().nullable().optional(),
  /** The risk this realised, when the register had it. */
  riskId: z.string().uuid().nullable().optional(),
  personalDataBreach: z.boolean().optional(),
});
export class ReportIncidentDto extends createZodDto(ReportIncidentSchema) {}

export const UpdateIncidentSchema = ReportIncidentSchema.omit({ reference: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Supply at least one field to update');
export class UpdateIncidentDto extends createZodDto(UpdateIncidentSchema) {}

export const TriageIncidentSchema = z.object({
  /** The responder. Triage IS the assignment, so this is required rather than optional. */
  assignedTo: z.string().uuid(),
});
export class TriageIncidentDto extends createZodDto(TriageIncidentSchema) {}

export const ContainIncidentSchema = z.object({
  /** Defaults to now. Supply it when writing up after the fact. */
  containedAt: z.string().datetime().optional(),
});
export class ContainIncidentDto extends createZodDto(ContainIncidentSchema) {}

export const ResolveIncidentSchema = z.object({
  /** Required by `ck_incident_resolution_evidence`: no cause means it is still open. */
  rootCause: evidence,
  resolvedAt: z.string().datetime().optional(),
});
export class ResolveIncidentDto extends createZodDto(ResolveIncidentSchema) {}

export const CloseIncidentSchema = z.object({
  /** Required by `ck_incident_closure_evidence` — ISO 27001 A.5.27. */
  lessonsLearned: evidence,
  closedAt: z.string().datetime().optional(),
});
export class CloseIncidentDto extends createZodDto(CloseIncidentSchema) {}

export const DismissIncidentSchema = z.object({
  reason: evidence,
});
export class DismissIncidentDto extends createZodDto(DismissIncidentSchema) {}

export const RecordEventSchema = z.object({
  type: eventType,
  detail: z.string().min(3).max(5000),
  /** When it happened, which may precede when it is being written down. Defaults to now. */
  occurredAt: z.string().datetime().optional(),
});
export class RecordEventDto extends createZodDto(RecordEventSchema) {}

export const NotifyRegulatorSchema = z.object({
  /** When the supervisory authority was actually told. Defaults to now. */
  notifiedAt: z.string().datetime().optional(),
});
export class NotifyRegulatorDto extends createZodDto(NotifyRegulatorSchema) {}

export const ListIncidentsQuerySchema = z
  .object({
    status: status.optional(),
    severity: severity.optional(),
    category: z.string().max(64).optional(),
    assignedTo: z.string().uuid().optional(),
    riskId: z.string().uuid().optional(),
    /** Everything not closed or dismissed — the response queue. */
    openOnly: z.coerce.boolean().optional(),
    breachesOnly: z.coerce.boolean().optional(),
  })
  .merge(PaginationQuerySchema);
export class ListIncidentsQueryDto extends createZodDto(ListIncidentsQuerySchema) {}

// ── Responses ─────────────────────────────────────────────────────────────────

export class IncidentResponseDto {
  id!: string;
  reference!: string;
  title!: string;
  description!: string;
  category!: string;
  severity!: string;
  status!: string;
  detectedAt!: string;
  reportedBy!: string;
  assignedTo!: string | null;
  containedAt!: string | null;
  resolvedAt!: string | null;
  closedAt!: string | null;
  rootCause!: string | null;
  lessonsLearned!: string | null;
  assetId!: string | null;
  riskId!: string | null;
  personalDataBreach!: boolean;
  /**
   * `detectedAt + 72 hours`, computed — null unless this is a personal-data breach.
   *
   * Not a stored column: `timestamptz + interval` is only STABLE, so Postgres refuses it as a
   * generated column. Derived in one place per layer instead.
   */
  notificationDueAt!: string | null;
  regulatorNotifiedAt!: string | null;
  createdAt!: string;
}

export class IncidentEventResponseDto {
  id!: string;
  incidentId!: string;
  type!: string;
  detail!: string;
  recordedBy!: string;
  /** When it happened — which is not necessarily when it was recorded. */
  occurredAt!: string;
  createdAt!: string;
}

export class OverdueBreachResponseDto {
  id!: string;
  reference!: string;
  title!: string;
  severity!: string;
  detectedAt!: string;
  notificationDueAt!: string;
  hoursOverdue!: number;
}
