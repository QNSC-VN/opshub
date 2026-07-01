import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { softwareCatalog, complianceFindings } from '../../../../../../db/schema';
import type { IComplianceRepository } from '../../domain/ports/compliance.repository';
import type {
  ComplianceFinding,
  CreateFindingInput,
  FindingFilters,
  FindingStatus,
  SoftwareCatalogEntry,
  SoftwareFilters,
  UpsertSoftwareInput,
} from '../../domain/compliance.types';

@Injectable()
export class ComplianceDrizzleRepository implements IComplianceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async createSoftware(input: UpsertSoftwareInput): Promise<SoftwareCatalogEntry> {
    const [row] = await this.db
      .insert(softwareCatalog)
      .values({
        id: newId(),
        name: input.name,
        publisher: input.publisher ?? null,
        listing: input.listing,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  }

  async findSoftwareById(id: string): Promise<SoftwareCatalogEntry | null> {
    const [row] = await this.db
      .select()
      .from(softwareCatalog)
      .where(eq(softwareCatalog.id, id))
      .limit(1);
    return (row) ?? null;
  }

  async findSoftwareByName(name: string): Promise<SoftwareCatalogEntry | null> {
    const [row] = await this.db
      .select()
      .from(softwareCatalog)
      .where(eq(softwareCatalog.name, name))
      .limit(1);
    return (row) ?? null;
  }

  async updateSoftware(
    id: string,
    patch: Partial<UpsertSoftwareInput>,
  ): Promise<SoftwareCatalogEntry | null> {
    const [row] = await this.db
      .update(softwareCatalog)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.publisher !== undefined ? { publisher: patch.publisher } : {}),
        ...(patch.listing !== undefined ? { listing: patch.listing } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(softwareCatalog.id, id))
      .returning();
    return (row) ?? null;
  }

  async listSoftware(
    filters: SoftwareFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoftwareCatalogEntry[]; total: number }> {
    const conditions = [
      filters.listing ? eq(softwareCatalog.listing, filters.listing) : undefined,
      filters.search ? ilike(softwareCatalog.name, `%${filters.search}%`) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(softwareCatalog)
      .where(where)
      .orderBy(desc(softwareCatalog.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(softwareCatalog)
      .where(where);

    return { rows: rows, total: count };
  }

  async createFinding(input: CreateFindingInput): Promise<ComplianceFinding> {
    const [row] = await this.db
      .insert(complianceFindings)
      .values({
        id: newId(),
        assetId: input.assetId ?? null,
        employeeId: input.employeeId ?? null,
        softwareName: input.softwareName,
        softwareVersion: input.softwareVersion ?? null,
        severity: input.severity,
        source: input.source,
        detectedAt: input.detectedAt ?? new Date(),
      })
      .returning();
    return row!;
  }

  async findFindingById(id: string): Promise<ComplianceFinding | null> {
    const [row] = await this.db
      .select()
      .from(complianceFindings)
      .where(eq(complianceFindings.id, id))
      .limit(1);
    return (row) ?? null;
  }

  async listFindings(
    filters: FindingFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ComplianceFinding[]; total: number }> {
    const conditions = [
      filters.status ? eq(complianceFindings.status, filters.status) : undefined,
      filters.severity ? eq(complianceFindings.severity, filters.severity) : undefined,
      filters.assetId ? eq(complianceFindings.assetId, filters.assetId) : undefined,
      filters.employeeId ? eq(complianceFindings.employeeId, filters.employeeId) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(complianceFindings)
      .where(where)
      .orderBy(desc(complianceFindings.detectedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(complianceFindings)
      .where(where);

    return { rows: rows, total: count };
  }

  async setFindingStatus(
    id: string,
    status: FindingStatus,
    resolvedBy: string | null,
    note: string | null,
  ): Promise<ComplianceFinding | null> {
    const resolved = status === 'resolved' || status === 'risk_accepted';
    const [row] = await this.db
      .update(complianceFindings)
      .set({
        status,
        resolvedBy: resolved ? resolvedBy : null,
        resolutionNote: note,
        resolvedAt: resolved ? new Date() : null,
      })
      .where(eq(complianceFindings.id, id))
      .returning();
    return (row) ?? null;
  }
}
