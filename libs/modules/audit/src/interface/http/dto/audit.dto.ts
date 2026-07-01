import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AuditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

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
