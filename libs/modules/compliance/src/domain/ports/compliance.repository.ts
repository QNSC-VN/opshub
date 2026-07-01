import type {
  ComplianceFinding,
  CreateFindingInput,
  FindingFilters,
  FindingStatus,
  SoftwareCatalogEntry,
  SoftwareFilters,
  UpsertSoftwareInput,
} from '../compliance.types';

export const COMPLIANCE_REPOSITORY = Symbol('COMPLIANCE_REPOSITORY');

export interface IComplianceRepository {
  createSoftware(input: UpsertSoftwareInput): Promise<SoftwareCatalogEntry>;
  findSoftwareById(id: string): Promise<SoftwareCatalogEntry | null>;
  findSoftwareByName(name: string): Promise<SoftwareCatalogEntry | null>;
  updateSoftware(
    id: string,
    patch: Partial<UpsertSoftwareInput>,
  ): Promise<SoftwareCatalogEntry | null>;
  listSoftware(
    filters: SoftwareFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoftwareCatalogEntry[]; total: number }>;

  createFinding(input: CreateFindingInput): Promise<ComplianceFinding>;
  findFindingById(id: string): Promise<ComplianceFinding | null>;
  listFindings(
    filters: FindingFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ComplianceFinding[]; total: number }>;
  setFindingStatus(
    id: string,
    status: FindingStatus,
    resolvedBy: string | null,
    note: string | null,
  ): Promise<ComplianceFinding | null>;
}
