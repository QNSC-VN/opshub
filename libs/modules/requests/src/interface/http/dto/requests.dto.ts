import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAGE_SIZE } from '@shared-kernel';

export const ListRequestsQuerySchema = z.object({
  type: z.string().optional(),
  status: z
    .enum(['pending', 'in_review', 'approved', 'rejected', 'cancelled', 'expired'])
    .optional(),
  requesterId: z.string().uuid().optional(),
  myQueue: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE.NOTIFICATION_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

export class ListRequestsQueryDto extends createZodDto(ListRequestsQuerySchema) {}

export const ReviewRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});

export class ReviewRequestDto extends createZodDto(ReviewRequestSchema) {}

export const AddCommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

export class AddCommentDto extends createZodDto(AddCommentSchema) {}

export class RequestCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true }) editedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class RequestApprovalResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() step!: number;
  @ApiProperty() approverId!: string;
  @ApiProperty() decision!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Set when approver was acting as delegate for this user' })
  delegatedFromId!: string | null;
  @ApiProperty() decidedAt!: string;
}

export class RequestItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() requesterId!: string;
  @ApiPropertyOptional({ nullable: true }) assigneeId!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() priority!: string;
  @ApiProperty() payload!: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true }) resolutionNote!: string | null;
  @ApiProperty() submittedAt!: string;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) expiresAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'SLA threshold hours for this request type' })
  slaHours!: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Absolute SLA deadline' })
  slaDeadline!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'When SLA breach was first detected' })
  slaBreachedAt!: string | null;
  @ApiProperty({ description: 'Current approval step (1-based). Increments as each step is approved.' })
  currentStep!: number;
  @ApiProperty({ description: 'Total approval steps required (from TypeDef). 1 = single-step.' })
  totalSteps!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ type: [RequestApprovalResponseDto] })
  approvals!: RequestApprovalResponseDto[];
}
