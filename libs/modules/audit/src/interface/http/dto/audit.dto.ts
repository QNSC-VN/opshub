import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';

export const AuditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
}).merge(PaginationQuerySchema);

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
