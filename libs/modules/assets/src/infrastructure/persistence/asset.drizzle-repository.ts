import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB, type DbExecutor } from '@platform';
import { newId } from '@shared-kernel';
import { assets, assetAssignments } from '../../../../../../db/schema';
import type { IAssetRepository } from '../../domain/ports/asset.repository';
import type { Asset, AssetAssignment, AssetFilters, CreateAssetInput } from '../../domain/asset.types';

@Injectable()
export class AssetDrizzleRepository implements IAssetRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateAssetInput): Promise<Asset> {
    const [row] = await this.db
      .insert(assets)
      .values({
        id: newId(),
        assetTag: input.assetTag,
        type: input.type,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        mdmDeviceId: input.mdmDeviceId ?? null,
        purchaseDate: input.purchaseDate ?? null,
        warrantyExpiry: input.warrantyExpiry ?? null,
        specs: input.specs ?? {},
      })
      .returning();
    return row as Asset;
  }

  async findById(id: string, tx?: DbExecutor): Promise<Asset | null> {
    const exec = tx ?? this.db;
    const [row] = await exec.select().from(assets).where(eq(assets.id, id)).limit(1);
    return (row as Asset) ?? null;
  }

  async findByTag(assetTag: string): Promise<Asset | null> {
    const [row] = await this.db.select().from(assets).where(eq(assets.assetTag, assetTag)).limit(1);
    return (row as Asset) ?? null;
  }

  async list(
    filters: AssetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Asset[]; total: number }> {
    const conditions = [
      filters.status ? eq(assets.status, filters.status) : undefined,
      filters.type ? eq(assets.type, filters.type) : undefined,
      filters.assignedTo ? eq(assets.assignedTo, filters.assignedTo) : undefined,
      filters.search
        ? or(
            ilike(assets.assetTag, `%${filters.search}%`),
            ilike(assets.serialNumber, `%${filters.search}%`),
            ilike(assets.model, `%${filters.search}%`),
          )
        : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(assets)
      .where(where)
      .orderBy(desc(assets.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(where);

    return { rows: rows as Asset[], total: count };
  }

  async assign(
    assetId: string,
    employeeId: string,
    notes: string | null,
    tx: DbExecutor,
  ): Promise<void> {
    await tx
      .update(assets)
      .set({ status: 'assigned', assignedTo: employeeId, updatedAt: new Date() })
      .where(eq(assets.id, assetId));
    await tx.insert(assetAssignments).values({
      id: newId(),
      assetId,
      employeeId,
      notes,
    });
  }

  async unassign(assetId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(assets)
      .set({ status: 'in_stock', assignedTo: null, updatedAt: new Date() })
      .where(eq(assets.id, assetId));
    await tx
      .update(assetAssignments)
      .set({ returnedAt: new Date() })
      .where(and(eq(assetAssignments.assetId, assetId), isNull(assetAssignments.returnedAt)));
  }

  async retire(assetId: string): Promise<void> {
    await this.db
      .update(assets)
      .set({ status: 'retired', assignedTo: null, updatedAt: new Date() })
      .where(eq(assets.id, assetId));
  }

  async listAssignments(assetId: string): Promise<AssetAssignment[]> {
    const rows = await this.db
      .select()
      .from(assetAssignments)
      .where(eq(assetAssignments.assetId, assetId))
      .orderBy(desc(assetAssignments.assignedAt));
    return rows as AssetAssignment[];
  }

  async updatePhoto(assetId: string, photoStorageKey: string | null): Promise<void> {
    await this.db
      .update(assets)
      .set({ photoStorageKey, updatedAt: new Date() })
      .where(eq(assets.id, assetId));
  }
}
