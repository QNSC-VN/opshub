import type { licenseTypeEnum, licenseStatusEnum } from '../../../../../db/schema';

export type LicenseType = (typeof licenseTypeEnum.enumValues)[number];
export type LicenseStatus = (typeof licenseStatusEnum.enumValues)[number];

export interface SoftwareLicense {
  id: string;
  name: string;
  vendor: string;
  licenseType: LicenseType;
  seatCount: number | null;
  costPerSeatCents: number | null;
  renewalDate: string | null;
  status: LicenseStatus;
  notes: string | null;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LicenseAssignment {
  id: string;
  licenseId: string;
  employeeId: string;
  assignedAt: Date;
  revokedAt: Date | null;
  notes: string | null;
}

export interface LicenseUtilization {
  licenseId: string;
  name: string;
  vendor: string;
  seatCount: number | null;
  usedSeats: number;
  availableSeats: number | null;
  utilizationPct: number | null;
  monthlySpendCents: number | null;
}

export interface CreateLicenseInput {
  name: string;
  vendor: string;
  licenseType: LicenseType;
  seatCount?: number | null;
  costPerSeatCents?: number | null;
  renewalDate?: string | null;
  notes?: string | null;
  externalId?: string | null;
}

export interface UpdateLicenseInput {
  name?: string;
  vendor?: string;
  licenseType?: LicenseType;
  seatCount?: number | null;
  costPerSeatCents?: number | null;
  renewalDate?: string | null;
  status?: LicenseStatus;
  notes?: string | null;
  externalId?: string | null;
}

export interface LicenseFilters {
  status?: LicenseStatus;
  vendor?: string;
  search?: string;
}
