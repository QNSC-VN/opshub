export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  iconEmoji: string | null;
  approvalPermission: string;
  slaHours: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCatalogItemInput {
  name: string;
  description?: string | null;
  category: string;
  iconEmoji?: string | null;
  approvalPermission: string;
  slaHours?: number | null;
  sortOrder?: number;
}

export interface UpdateCatalogItemInput {
  name?: string;
  description?: string | null;
  category?: string;
  iconEmoji?: string | null;
  approvalPermission?: string;
  slaHours?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}
