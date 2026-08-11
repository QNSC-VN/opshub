import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { queryBoolean } from '@platform';
import { PaginationQuerySchema } from '@shared-kernel';
import { positionStatusEnum } from '@db/schema/enums';

const status = z.enum(positionStatusEnum.enumValues);

export const CreatePositionSchema = z.object({
  /** Uppercase pattern for the same reason document codes have one: it is quoted in plans. */
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Z][A-Z0-9-]*$/, 'Use uppercase letters, digits and hyphens, e.g. ENG-QA-02'),
  title: z.string().min(2).max(160),
  department: z.string().min(2).max(120),
  level: z.string().max(40).optional(),
  /** At least 1: a position permitting nobody is a closed position, expressed by `status`. */
  headcount: z.number().int().min(1).max(10_000).optional(),
  description: z.string().max(5000).optional(),
});
export class CreatePositionDto extends createZodDto(CreatePositionSchema) {}

export const UpdatePositionSchema = z
  .object({
    title: z.string().min(2).max(160).optional(),
    department: z.string().min(2).max(120).optional(),
    level: z.string().max(40).nullable().optional(),
    headcount: z.number().int().min(1).max(10_000).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: status.optional(),
  })
  // An empty PATCH is a no-op the caller almost certainly did not mean, and it would still write
  // an audit entry claiming a change.
  .refine((v) => Object.keys(v).length > 0, 'Supply at least one field to update');
export class UpdatePositionDto extends createZodDto(UpdatePositionSchema) {}

export const ListPositionsQuerySchema = z
  .object({
    department: z.string().max(120).optional(),
    status: status.optional(),
    vacantOnly: queryBoolean().optional(),
  })
  .merge(PaginationQuerySchema);
export class ListPositionsQueryDto extends createZodDto(ListPositionsQuerySchema) {}

export const AssignPositionSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: z.string().date(),
  /** Why the PREVIOUS assignment ended, when this is a transfer. Defaults to 'transfer'. */
  endReason: z.string().max(120).optional(),
});
export class AssignPositionDto extends createZodDto(AssignPositionSchema) {}

export const EndAssignmentSchema = z.object({
  effectiveTo: z.string().date(),
  endReason: z.string().max(120).optional(),
});
export class EndAssignmentDto extends createZodDto(EndAssignmentSchema) {}

export class PositionResponseDto {
  id!: string;
  code!: string;
  title!: string;
  department!: string;
  level!: string | null;
  headcount!: number;
  description!: string | null;
  status!: string;
  createdAt!: string;
}

export class PositionOccupancyResponseDto extends PositionResponseDto {
  /** Open assignments — someone who left last month does not occupy a slot. */
  filled!: number;
  /** `headcount - filled`, floored at 0: a reduced headcount must not report negative vacancies. */
  vacancies!: number;
}

export class EmployeePositionResponseDto {
  id!: string;
  employeeId!: string;
  positionId!: string;
  effectiveFrom!: string;
  effectiveTo!: string | null;
  endReason!: string | null;
  createdAt!: string;
}
