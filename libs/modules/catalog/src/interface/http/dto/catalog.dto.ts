import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCatalogItemSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().min(1).max(80),
  iconEmoji: z.string().max(10).optional().nullable(),
  approvalPermission: z.string().min(1).max(100),
  slaHours: z.number().int().positive().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});
export class CreateCatalogItemDto extends createZodDto(CreateCatalogItemSchema) {}

export const UpdateCatalogItemSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).optional().nullable(),
  category: z.string().min(1).max(80).optional(),
  iconEmoji: z.string().max(10).optional().nullable(),
  approvalPermission: z.string().min(1).max(100).optional(),
  slaHours: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export class UpdateCatalogItemDto extends createZodDto(UpdateCatalogItemSchema) {}

export const SubmitCatalogRequestSchema = z.object({
  reason: z.string().min(10).max(1000),
});
export class SubmitCatalogRequestDto extends createZodDto(SubmitCatalogRequestSchema) {}

export class CatalogItemResponseDto {
  id!: string;
  name!: string;
  description!: string | null;
  category!: string;
  iconEmoji!: string | null;
  approvalPermission!: string;
  slaHours!: number | null;
  isActive!: boolean;
  sortOrder!: number;
  createdAt!: string;
}

export class ListCatalogQueryDto {
  includeInactive?: boolean;
}
