import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { licenseTypeEnum, licenseStatusEnum } from '@db/schema/enums';

const licenseTypeZ = z.enum(licenseTypeEnum.enumValues);
const licenseStatusZ = z.enum(licenseStatusEnum.enumValues);

export const CreateLicenseSchema = z.object({
  name: z.string().min(1).max(150),
  vendor: z.string().min(1).max(120),
  licenseType: licenseTypeZ,
  seatCount: z.number().int().positive().optional().nullable(),
  costPerSeatCents: z.number().int().nonnegative().optional().nullable(),
  renewalDate: z.string().date().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  externalId: z.string().max(200).optional().nullable(),
});
export class CreateLicenseDto extends createZodDto(CreateLicenseSchema) {}

export const UpdateLicenseSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  vendor: z.string().min(1).max(120).optional(),
  licenseType: licenseTypeZ.optional(),
  seatCount: z.number().int().positive().optional().nullable(),
  costPerSeatCents: z.number().int().nonnegative().optional().nullable(),
  renewalDate: z.string().date().optional().nullable(),
  status: licenseStatusZ.optional(),
  notes: z.string().max(2000).optional().nullable(),
  externalId: z.string().max(200).optional().nullable(),
});
export class UpdateLicenseDto extends createZodDto(UpdateLicenseSchema) {}

export const ListLicensesQuerySchema = z.object({
  status: licenseStatusZ.optional(),
  vendor: z.string().optional(),
  search: z.string().optional(),
}).merge(PaginationQuerySchema);
export class ListLicensesQueryDto extends createZodDto(ListLicensesQuerySchema) {}

export const AssignSeatSchema = z.object({
  employeeId: z.string().uuid(),
  notes: z.string().max(500).optional().nullable(),
});
export class AssignSeatDto extends createZodDto(AssignSeatSchema) {}

export const ListAssignmentsQuerySchema = z.object({
  includeRevoked: z.coerce.boolean().default(false),
});
export class ListAssignmentsQueryDto extends createZodDto(ListAssignmentsQuerySchema) {}

export class LicenseResponseDto {
  id!: string;
  name!: string;
  vendor!: string;
  licenseType!: string;
  seatCount!: number | null;
  costPerSeatCents!: number | null;
  renewalDate!: string | null;
  status!: string;
  notes!: string | null;
  externalId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}

export class LicenseAssignmentResponseDto {
  id!: string;
  licenseId!: string;
  employeeId!: string;
  assignedAt!: string;
  revokedAt!: string | null;
  notes!: string | null;
}

export class LicenseUtilizationDto {
  licenseId!: string;
  name!: string;
  vendor!: string;
  seatCount!: number | null;
  usedSeats!: number;
  availableSeats!: number | null;
  utilizationPct!: number | null;
  monthlySpendCents!: number | null;
}
