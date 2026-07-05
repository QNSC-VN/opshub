import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { accessTypeEnum } from '@db/schema/enums';

const accessType = z.enum(accessTypeEnum.enumValues);

export const SubmitAccessRequestSchema = z.object({
  accessType,
  target: z.string().min(1).max(200),
  justification: z.string().min(10),
  durationHours: z.number().int().min(1).max(720),
});

export class SubmitAccessRequestDto extends createZodDto(SubmitAccessRequestSchema) {}

export const ReviewAccessRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});

export class ReviewAccessRequestDto extends createZodDto(ReviewAccessRequestSchema) {}

export const ListAccessRequestsQuerySchema = z.object({
  requesterId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'revoked']).optional(),
}).merge(PaginationQuerySchema);

export class ListAccessRequestsQueryDto extends createZodDto(ListAccessRequestsQuerySchema) {}

export class AccessRequestResponseDto {
  id!: string;
  requesterId!: string;
  accessType!: string;
  target!: string;
  justification!: string;
  durationHours!: string;
  status!: string;
  reviewerId!: string | null;
  reviewNote!: string | null;
  reviewedAt!: string | null;
  createdAt!: string;
}

export class AccessGrantResponseDto {
  id!: string;
  requestId!: string;
  granteeId!: string;
  accessType!: string;
  target!: string;
  grantedAt!: string;
  expiresAt!: string;
  revokedAt!: string | null;
}
