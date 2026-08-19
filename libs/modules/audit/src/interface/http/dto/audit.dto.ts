import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { AUDIT_RESOURCE, type AuditResource } from '../../../domain/audit-catalogue';

/**
 * The catalogue's values as a tuple, which is the shape `z.enum` needs. Derived rather than restated,
 * so a resource added to the catalogue becomes queryable without a second edit here.
 */
const AUDIT_RESOURCE_VALUES = Object.values(AUDIT_RESOURCE) as [AuditResource, ...AuditResource[]];

export const AuditQuerySchema = z
  .object({
    actorId: z.string().uuid().optional(),
    /**
     * Case-insensitive substring of the actor's email.
     *
     * Added because the SPA has always offered an "actor email" filter box and the API only ever
     * accepted `actorId` — a UUID — so the field silently did nothing. Investigating an incident starts
     * from an email address, not from an id.
     */
    actorEmail: z.string().min(1).max(255).optional(),
    /*
     * VALIDATED AGAINST THE CATALOGUE, so an unknown resource type is refused rather than answered
     * with an empty list.
     *
     * Seven detail drawers sent a type this API has never written — `leave` for `leave_request`,
     * `finding` for `compliance_finding`, `access-request` with a hyphen — and got back `[]`. Their
     * Activity timeline then rendered its empty state forever, and because `ActivityTimeline` never
     * throws by design, an unmatched type and a genuinely quiet record looked identical.
     *
     * Narrowing it here does two things: the API fails loudly on a typo, and the generated client
     * hands the SPA a union, so the next wrong value is a compile error rather than a blank panel.
     */
    resourceType: z.enum(AUDIT_RESOURCE_VALUES).optional(),
    resourceId: z.string().optional(),
    action: z.string().optional(),
  })
  .merge(PaginationQuerySchema);

export class AuditQueryDto extends createZodDto(AuditQuerySchema) {}

export class AuditLogResponseDto {
  id!: string;
  actorId!: string | null;
  actorEmail!: string | null;
  action!: string;
  /**
   * Left as `string` deliberately: this is a READ of a varchar column, and a row written before the
   * catalogue was typed could hold a value the catalogue no longer lists. Narrowing the response would
   * be a claim about historical data rather than about this API's behaviour.
   *
   * The direction that needed narrowing is the QUERY — see `AuditQuerySchema.resourceType`.
   */
  resourceType!: string;
  resourceId!: string | null;
  changes!: unknown;
  metadata!: Record<string, unknown>;
  occurredAt!: string;
}
