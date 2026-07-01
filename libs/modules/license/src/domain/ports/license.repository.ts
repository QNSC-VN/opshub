import type {
  SoftwareLicense,
  LicenseAssignment,
  LicenseUtilization,
  CreateLicenseInput,
  UpdateLicenseInput,
  LicenseFilters,
} from '../license.types';

export const LICENSE_REPOSITORY = Symbol('LICENSE_REPOSITORY');

export interface ILicenseRepository {
  create(input: CreateLicenseInput): Promise<SoftwareLicense>;
  findById(id: string): Promise<SoftwareLicense | null>;
  list(filters: LicenseFilters, limit: number, offset: number): Promise<{ rows: SoftwareLicense[]; total: number }>;
  update(id: string, input: UpdateLicenseInput): Promise<SoftwareLicense | null>;
  delete(id: string): Promise<void>;

  assign(licenseId: string, employeeId: string, notes: string | null): Promise<LicenseAssignment>;
  revoke(assignmentId: string): Promise<void>;
  listAssignments(licenseId: string, includeRevoked: boolean): Promise<LicenseAssignment[]>;
  findActiveAssignment(licenseId: string, employeeId: string): Promise<LicenseAssignment | null>;
  countActiveSeats(licenseId: string): Promise<number>;

  getUtilization(): Promise<LicenseUtilization[]>;
}
