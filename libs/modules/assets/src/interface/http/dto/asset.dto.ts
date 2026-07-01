import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const assetType = z.enum([
  'laptop',
  'desktop',
  'monitor',
  'phone',
  'tablet',
  'peripheral',
  'other',
]);

export const CreateAssetSchema = z.object({
  assetTag: z.string().min(1).max(50),
  type: assetType,
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  serialNumber: z.string().max(120).optional(),
  mdmDeviceId: z.string().max(128).optional(),
  purchaseDate: z.string().date().optional(),
  warrantyExpiry: z.string().date().optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
});

export class CreateAssetDto extends createZodDto(CreateAssetSchema) {}

export const ListAssetsQuerySchema = z.object({
  status: z.enum(['in_stock', 'assigned', 'in_repair', 'retired', 'lost']).optional(),
  type: assetType.optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export class ListAssetsQueryDto extends createZodDto(ListAssetsQuerySchema) {}

export const AssignAssetSchema = z.object({
  employeeId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export class AssignAssetDto extends createZodDto(AssignAssetSchema) {}

export class AssetResponseDto {
  id!: string;
  assetTag!: string;
  type!: string;
  status!: string;
  manufacturer!: string | null;
  model!: string | null;
  serialNumber!: string | null;
  mdmDeviceId!: string | null;
  purchaseDate!: string | null;
  warrantyExpiry!: string | null;
  specs!: Record<string, unknown>;
  assignedTo!: string | null;
  photoStorageKey!: string | null;
  createdAt!: string;
}

export class AssetAssignmentResponseDto {
  id!: string;
  assetId!: string;
  employeeId!: string;
  assignedAt!: string;
  returnedAt!: string | null;
  notes!: string | null;
}

export const PresignAssetPhotoSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
});
export class PresignAssetPhotoDto extends createZodDto(PresignAssetPhotoSchema) {}

export const ConfirmAssetPhotoSchema = z.object({
  fileId: z.string().uuid(),
});
export class ConfirmAssetPhotoDto extends createZodDto(ConfirmAssetPhotoSchema) {}
