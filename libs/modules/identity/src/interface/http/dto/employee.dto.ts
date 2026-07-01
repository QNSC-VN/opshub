import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// NOTE: Roles are intentionally NOT settable here. Role assignment is a
// governance action handled exclusively by the authz module
// (POST /v1/authz/assignments, guarded by `role.assign` + escalation check).
// This prevents privilege escalation via the directory/employee endpoints.
export const CreateEmployeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200),
  department: z.string().max(120).optional(),
  jobTitle: z.string().max(120).optional(),
  managerId: z.string().uuid().optional(),
  entraOid: z.string().max(64).optional(),
});

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}

export const ListEmployeesQuerySchema = z.object({
  status: z.enum(['active', 'on_leave', 'offboarded']).optional(),
  department: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export class ListEmployeesQueryDto extends createZodDto(ListEmployeesQuerySchema) {}

// Roles are NOT updatable here — see CreateEmployeeSchema note. Use the authz
// module to grant/revoke roles.
export const UpdateEmployeeSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  department: z.string().max(120).nullable().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
});
export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}

export const UpdateStatusSchema = z.object({
  status: z.enum(['active', 'on_leave', 'offboarded']),
});
export class UpdateStatusDto extends createZodDto(UpdateStatusSchema) {}

export class EmployeeResponseDto {
  id!: string;
  email!: string;
  displayName!: string;
  department!: string | null;
  jobTitle!: string | null;
  managerId!: string | null;
  roles!: string[];
  status!: string;
  photoStorageKey!: string | null;
  createdAt!: string;
}

export const PresignAvatarSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
});
export class PresignAvatarDto extends createZodDto(PresignAvatarSchema) {}

export const ConfirmAvatarSchema = z.object({
  fileId: z.string().uuid(),
});
export class ConfirmAvatarDto extends createZodDto(ConfirmAvatarSchema) {}
