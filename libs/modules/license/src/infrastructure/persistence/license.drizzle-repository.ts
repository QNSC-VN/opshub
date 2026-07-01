import { Injectable } from '@nestjs/common';
import { and, count, eq, ilike, isNull, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { softwareLicenses, licenseAssignments } from '../../../../../../db/schema';
import type { ILicenseRepository } from '../../domain/ports/license.repository';
import type {
  SoftwareLicense,
  LicenseAssignment,
  LicenseUtilization,
  CreateLicenseInput,
  UpdateLicenseInput,
  LicenseFilters,
} from '../../domain/license.types';

@Injectable()
export class LicenseDrizzleRepository implements ILicenseRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateLicenseInput): Promise<SoftwareLicense> {
    const [row] = await this.db
      .insert(softwareLicenses)
      .values({
        id: newId(),
        name: input.name,
        vendor: input.vendor,
        licenseType: input.licenseType,
        seatCount: input.seatCount ?? null,
        costPerSeatCents: input.costPerSeatCents ?? null,
        renewalDate: input.renewalDate ?? null,
        notes: input.notes ?? null,
        externalId: input.externalId ?? null,
      })
      .returning();
    return row!;
  }

  async findById(id: string): Promise<SoftwareLicense | null> {
    const [row] = await this.db
      .select()
      .from(softwareLicenses)
      .where(eq(softwareLicenses.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(
    filters: LicenseFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoftwareLicense[]; total: number }> {
    const conditions = [
      filters.status ? eq(softwareLicenses.status, filters.status) : undefined,
      filters.vendor ? ilike(softwareLicenses.vendor, `%${filters.vendor}%`) : undefined,
      filters.search ? ilike(softwareLicenses.name, `%${filters.search}%`) : undefined,
    ].filter(Boolean);

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [countRow]] = await Promise.all([
      this.db.select().from(softwareLicenses).where(where).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(softwareLicenses).where(where),
    ]);

    return { rows, total: countRow?.total ?? 0 };
  }

  async update(id: string, input: UpdateLicenseInput): Promise<SoftwareLicense | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch['name'] = input.name;
    if (input.vendor !== undefined) patch['vendor'] = input.vendor;
    if (input.licenseType !== undefined) patch['licenseType'] = input.licenseType;
    if ('seatCount' in input) patch['seatCount'] = input.seatCount;
    if ('costPerSeatCents' in input) patch['costPerSeatCents'] = input.costPerSeatCents;
    if ('renewalDate' in input) patch['renewalDate'] = input.renewalDate;
    if (input.status !== undefined) patch['status'] = input.status;
    if ('notes' in input) patch['notes'] = input.notes;
    if ('externalId' in input) patch['externalId'] = input.externalId;

    const [row] = await this.db
      .update(softwareLicenses)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      .set(patch as any)
      .where(eq(softwareLicenses.id, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(softwareLicenses).where(eq(softwareLicenses.id, id));
  }

  async assign(licenseId: string, employeeId: string, notes: string | null): Promise<LicenseAssignment> {
    const [row] = await this.db
      .insert(licenseAssignments)
      .values({ id: newId(), licenseId, employeeId, notes })
      .returning();
    return row!;
  }

  async revoke(assignmentId: string): Promise<void> {
    await this.db
      .update(licenseAssignments)
      .set({ revokedAt: new Date() })
      .where(eq(licenseAssignments.id, assignmentId));
  }

  async listAssignments(licenseId: string, includeRevoked: boolean): Promise<LicenseAssignment[]> {
    const conditions = [eq(licenseAssignments.licenseId, licenseId)];
    if (!includeRevoked) conditions.push(isNull(licenseAssignments.revokedAt));
    return this.db
      .select()
      .from(licenseAssignments)
      .where(and(...conditions));
  }

  async findActiveAssignment(licenseId: string, employeeId: string): Promise<LicenseAssignment | null> {
    const [row] = await this.db
      .select()
      .from(licenseAssignments)
      .where(
        and(
          eq(licenseAssignments.licenseId, licenseId),
          eq(licenseAssignments.employeeId, employeeId),
          isNull(licenseAssignments.revokedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async countActiveSeats(licenseId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(licenseAssignments)
      .where(and(eq(licenseAssignments.licenseId, licenseId), isNull(licenseAssignments.revokedAt)));
    return row?.n ?? 0;
  }

  async getUtilization(): Promise<LicenseUtilization[]> {
    const rows = await this.db
      .select({
        licenseId: softwareLicenses.id,
        name: softwareLicenses.name,
        vendor: softwareLicenses.vendor,
        seatCount: softwareLicenses.seatCount,
        costPerSeatCents: softwareLicenses.costPerSeatCents,
        usedSeats: sql<number>`count(${licenseAssignments.id}) filter (where ${licenseAssignments.revokedAt} is null)`,
      })
      .from(softwareLicenses)
      .leftJoin(licenseAssignments, eq(softwareLicenses.id, licenseAssignments.licenseId))
      .groupBy(
        softwareLicenses.id,
        softwareLicenses.name,
        softwareLicenses.vendor,
        softwareLicenses.seatCount,
        softwareLicenses.costPerSeatCents,
      );

    return rows.map((r) => {
      const used = Number(r.usedSeats);
      const available = r.seatCount != null ? r.seatCount - used : null;
      const pct = r.seatCount != null && r.seatCount > 0 ? Math.round((used / r.seatCount) * 100) : null;
      const spend = r.costPerSeatCents != null ? used * r.costPerSeatCents : null;
      return {
        licenseId: r.licenseId,
        name: r.name,
        vendor: r.vendor,
        seatCount: r.seatCount,
        usedSeats: used,
        availableSeats: available,
        utilizationPct: pct,
        monthlySpendCents: spend,
      };
    });
  }
}
