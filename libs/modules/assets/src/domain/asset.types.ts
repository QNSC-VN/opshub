import type { assetTypeEnum, assetStatusEnum } from '../../../../../db/schema';

export type AssetType = (typeof assetTypeEnum.enumValues)[number];
export type AssetStatus = (typeof assetStatusEnum.enumValues)[number];

export interface Asset {
  id: string;
  assetTag: string;
  type: AssetType;
  status: AssetStatus;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  mdmDeviceId: string | null;
  purchaseDate: string | null;
  warrantyExpiry: string | null;
  specs: Record<string, unknown>;
  assignedTo: string | null;
  /** S3 object key for the asset photo; null until uploaded. */
  photoStorageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssetAssignment {
  id: string;
  assetId: string;
  employeeId: string;
  assignedAt: Date;
  returnedAt: Date | null;
  notes: string | null;
}

export interface CreateAssetInput {
  assetTag: string;
  type: AssetType;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  mdmDeviceId?: string | null;
  purchaseDate?: string | null;
  warrantyExpiry?: string | null;
  specs?: Record<string, unknown>;
}

export interface AssetFilters {
  status?: AssetStatus;
  type?: AssetType;
  assignedTo?: string;
  search?: string;
}
