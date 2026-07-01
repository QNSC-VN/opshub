import type {
  softwareListingEnum,
  findingStatusEnum,
  findingSeverityEnum,
} from '../../../../../db/schema';

export type SoftwareListing = (typeof softwareListingEnum.enumValues)[number];
export type FindingStatus = (typeof findingStatusEnum.enumValues)[number];
export type FindingSeverity = (typeof findingSeverityEnum.enumValues)[number];

export interface SoftwareCatalogEntry {
  id: string;
  name: string;
  publisher: string | null;
  listing: SoftwareListing;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ComplianceFinding {
  id: string;
  assetId: string | null;
  employeeId: string | null;
  softwareName: string;
  softwareVersion: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  source: string;
  detectedAt: Date;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
}

export interface UpsertSoftwareInput {
  name: string;
  publisher?: string | null;
  listing: SoftwareListing;
  notes?: string | null;
}

export interface SoftwareFilters {
  listing?: SoftwareListing;
  search?: string;
}

export interface FindingFilters {
  status?: FindingStatus;
  severity?: FindingSeverity;
  assetId?: string;
  employeeId?: string;
}

export interface CreateFindingInput {
  assetId?: string | null;
  employeeId?: string | null;
  softwareName: string;
  softwareVersion?: string | null;
  severity: FindingSeverity;
  source: string;
  detectedAt?: Date;
}
