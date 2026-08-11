import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';

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
    resourceType: z.string().optional(),
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
  resourceType!: string;
  resourceId!: string | null;
  changes!: unknown;
  metadata!: Record<string, unknown>;
  occurredAt!: string;
}
