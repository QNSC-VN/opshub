import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ScopeTypeSchema = z.enum(['global', 'self', 'team', 'dept', 'region']);

export const CreateRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'key must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(120),
  permissions: z.array(z.string().max(120)).default([]),
});
export class CreateRoleDto extends createZodDto(CreateRoleSchema) {}

export const SetRolePermissionsSchema = z.object({
  permissions: z.array(z.string().max(120)),
});
export class SetRolePermissionsDto extends createZodDto(SetRolePermissionsSchema) {}

export const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: ScopeTypeSchema.default('global'),
  scopeId: z.string().max(120).nullable().optional(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .transform((v) => (v != null ? new Date(v) : null)),
});
export class AssignRoleDto extends createZodDto(AssignRoleSchema) {}

export class PermissionResponseDto {
  key!: string;
  description!: string;
}

export class RoleResponseDto {
  id!: string;
  key!: string;
  name!: string;
  system!: boolean;
  permissions!: string[];
  updatedAt!: string;
}

export class RoleAssignmentResponseDto {
  id!: string;
  userId!: string;
  roleId!: string;
  scopeType!: string;
  scopeId!: string | null;
  grantedBy!: string;
  expiresAt!: string | null;
  createdAt!: string;
}

// ── Approval Delegation DTOs ──────────────────────────────────────────────────

export const CreateDelegationSchema = z.object({
  toUserId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }).transform((v) => new Date(v)),
  endsAt: z.string().datetime({ offset: true }).transform((v) => new Date(v)),
  reason: z.string().max(500).optional(),
});
export class CreateDelegationDto extends createZodDto(CreateDelegationSchema) {}

export const ListDelegationsQuerySchema = z.object({
  direction: z.enum(['from', 'to']).default('from'),
});
export class ListDelegationsQueryDto extends createZodDto(ListDelegationsQuerySchema) {}

export class DelegationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() fromUserId!: string;
  @ApiProperty() toUserId!: string;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiProperty() createdAt!: string;
}
