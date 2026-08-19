import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB, searchAcross } from '@platform';
import { newId } from '@shared-kernel';
import {
  assetClassificationHistory,
  assets,
  classificationLevels,
  informationAssetDevices,
  informationAssets,
} from '../../../../../../db/schema';
import type { IInformationAssetRepository } from '../../domain/ports/information-asset.repository';
import type {
  ClassificationChange,
  ClassificationLevel,
  ClassificationSummaryLine,
  DeviceHolding,
  InformationAsset,
  InformationAssetFilters,
  InformationAssetRow,
  InformationClassification,
  RegisterAssetInput,
  UpdateAssetInput,
} from '../../domain/information-asset.types';

/**
 * How many devices hold each asset, as a correlated subquery.
 *
 * A LEFT JOIN plus GROUP BY would work too, but every other column here is a plain projection and
 * the group-by list would then have to name all of them — which is how a column added later gets
 * silently dropped from the result.
 */
const DEVICE_COUNT = sql<number>`(
  SELECT count(*)::int FROM isms.information_asset_devices iad
  WHERE iad.information_asset_id = isms.information_assets.id
)`;

@Injectable()
export class InformationAssetDrizzleRepository implements IInformationAssetRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── Levels ───────────────────────────────────────────────────────────────────

  async listLevels(): Promise<ClassificationLevel[]> {
    return (
      this.db
        .select()
        .from(classificationLevels)
        // `rank` carries a UNIQUE constraint, so it already orders totally — `code` is appended
        // because it is the PRIMARY KEY, which makes the total order structural rather than
        // something a reader has to go and confirm in the migration.
        .orderBy(asc(classificationLevels.rank), asc(classificationLevels.code))
    );
  }

  // ── Register ─────────────────────────────────────────────────────────────────

  async create(
    input: RegisterAssetInput & { registeredBy: string },
    tx?: DbExecutor,
  ): Promise<InformationAsset> {
    const executor = tx ?? this.db;
    const [row] = await executor
      .insert(informationAssets)
      .values({
        id: newId(),
        reference: input.reference,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        classification: input.classification,
        ownerId: input.ownerId,
        custodianId: input.custodianId ?? null,
        confidentiality: input.confidentiality,
        integrity: input.integrity,
        availability: input.availability,
        personalData: input.personalData ?? false,
        location: input.location ?? null,
        retentionMonths: input.retentionMonths ?? null,
        reviewDueOn: input.reviewDueOn ?? null,
      })
      .returning();

    // The FIRST history row, with a null `fromLevel`. Written here rather than left to the caller
    // because an asset whose current label has no history cannot explain itself, and a second
    // caller registering assets some other way is exactly how that gap appears.
    await this.appendChange(
      row.id,
      {
        fromLevel: null,
        toLevel: input.classification,
        reason: input.classificationReason,
        changedBy: input.registeredBy,
      },
      executor,
    );

    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<InformationAsset | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(informationAssets)
      .where(eq(informationAssets.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<InformationAsset | null> {
    const [row] = await this.db
      .select()
      .from(informationAssets)
      .where(eq(informationAssets.reference, reference))
      .limit(1);
    return row ?? null;
  }

  async list(
    filters: InformationAssetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: InformationAssetRow[]; total: number }> {
    const where = and(
      filters.type ? eq(informationAssets.type, filters.type) : undefined,
      filters.classification
        ? eq(informationAssets.classification, filters.classification)
        : undefined,
      filters.ownerId
        ? or(
            eq(informationAssets.ownerId, filters.ownerId),
            // The custodian is included on purpose: "which assets am I responsible for" is one
            // question to the person answering it, and two filters would make the screen ask twice.
            eq(informationAssets.custodianId, filters.ownerId),
          )
        : undefined,
      filters.personalDataOnly ? eq(informationAssets.personalData, true) : undefined,
      filters.reviewDueOnOrBefore
        ? lte(informationAssets.reviewDueOn, filters.reviewDueOnOrBefore)
        : undefined,
      // The register means the CURRENT inventory, so retired rows are out unless asked for.
      filters.includeRetired ? undefined : isNull(informationAssets.retiredAt),
      searchAcross(filters.search, informationAssets.name, informationAssets.reference),
    );

    const rows = await this.db
      .select({
        ...informationAssetColumns(),
        classificationRank: classificationLevels.rank,
        encryptionRequired: classificationLevels.encryptionRequired,
        deviceCount: DEVICE_COUNT,
      })
      .from(informationAssets)
      // INNER join, and it cannot drop a row: `classification` is an FK to this table and NOT NULL.
      .innerJoin(
        classificationLevels,
        eq(classificationLevels.code, informationAssets.classification),
      )
      .where(where)
      // Most protected first — the register is read top-down when deciding what to look at. Ranked by
      // the LEVELS TABLE, never by the enum's declaration order. `id` last: neither rank nor name is
      // unique, and without the tiebreaker pagination drops and repeats rows.
      .orderBy(
        desc(classificationLevels.rank),
        asc(informationAssets.name),
        asc(informationAssets.id),
      )
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(informationAssets)
      .where(where);

    return { rows, total: count };
  }

  async update(
    id: string,
    input: UpdateAssetInput,
    tx?: DbExecutor,
  ): Promise<InformationAsset | null> {
    const [row] = await (tx ?? this.db)
      .update(informationAssets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(informationAssets.id, id))
      .returning();
    return row ?? null;
  }

  async reclassify(
    id: string,
    from: InformationClassification,
    to: InformationClassification,
    tx?: DbExecutor,
  ): Promise<InformationAsset | null> {
    const [row] = await (tx ?? this.db)
      .update(informationAssets)
      .set({ classification: to, updatedAt: new Date() })
      // The FROM level is in the WHERE clause. Without it, two reviewers reclassifying at once both
      // succeed and the history records a transition that never happened.
      .where(and(eq(informationAssets.id, id), eq(informationAssets.classification, from)))
      .returning();
    return row ?? null;
  }

  async markReviewed(
    id: string,
    reviewDueOn: string | null,
    tx?: DbExecutor,
  ): Promise<InformationAsset | null> {
    const [row] = await (tx ?? this.db)
      .update(informationAssets)
      .set({ lastReviewedAt: new Date(), reviewDueOn, updatedAt: new Date() })
      .where(eq(informationAssets.id, id))
      .returning();
    return row ?? null;
  }

  async retire(id: string, tx?: DbExecutor): Promise<InformationAsset | null> {
    const [row] = await (tx ?? this.db)
      .update(informationAssets)
      .set({ retiredAt: new Date(), updatedAt: new Date() })
      // Un-retired only, so the original retirement date survives a second attempt.
      .where(and(eq(informationAssets.id, id), isNull(informationAssets.retiredAt)))
      .returning();
    return row ?? null;
  }

  // ── Classification history ───────────────────────────────────────────────────

  async appendChange(
    informationAssetId: string,
    input: {
      fromLevel: InformationClassification | null;
      toLevel: InformationClassification;
      reason: string;
      changedBy: string;
    },
    tx?: DbExecutor,
  ): Promise<ClassificationChange> {
    const [row] = await (tx ?? this.db)
      .insert(assetClassificationHistory)
      .values({
        id: newId(),
        informationAssetId,
        fromLevel: input.fromLevel,
        toLevel: input.toLevel,
        reason: input.reason,
        changedBy: input.changedBy,
      })
      .returning();
    return row;
  }

  async listChanges(informationAssetId: string): Promise<ClassificationChange[]> {
    return (
      this.db
        .select()
        .from(assetClassificationHistory)
        .where(eq(assetClassificationHistory.informationAssetId, informationAssetId))
        // Oldest first: the history is read as a narrative, starting from the initial decision. `id`
        // last, because a bulk reclassification gives several rows the same timestamp.
        .orderBy(asc(assetClassificationHistory.changedAt), asc(assetClassificationHistory.id))
    );
  }

  // ── Devices ──────────────────────────────────────────────────────────────────

  async linkDevice(
    informationAssetId: string,
    deviceAssetId: string,
    linkedBy: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(informationAssetDevices)
      .values({ informationAssetId, deviceAssetId, linkedBy })
      // Linking twice is the same link. Idempotent rather than a 409, because the caller's intent —
      // "this device holds this" — is already true.
      .onConflictDoNothing();
  }

  async unlinkDevice(
    informationAssetId: string,
    deviceAssetId: string,
    tx?: DbExecutor,
  ): Promise<boolean> {
    const removed = await (tx ?? this.db)
      .delete(informationAssetDevices)
      .where(
        and(
          eq(informationAssetDevices.informationAssetId, informationAssetId),
          eq(informationAssetDevices.deviceAssetId, deviceAssetId),
        ),
      )
      .returning();
    return removed.length > 0;
  }

  async listDevicesFor(informationAssetId: string) {
    return this.db
      .select({
        deviceAssetId: assets.id,
        assetTag: assets.assetTag,
        type: sql<string>`${assets.type}::text`,
        status: sql<string>`${assets.status}::text`,
        assignedTo: assets.assignedTo,
      })
      .from(informationAssetDevices)
      .innerJoin(assets, eq(assets.id, informationAssetDevices.deviceAssetId))
      .where(eq(informationAssetDevices.informationAssetId, informationAssetId))
      .orderBy(asc(assets.assetTag), asc(assets.id));
  }

  // ── Reports ──────────────────────────────────────────────────────────────────

  async holdingsOnDevice(deviceAssetId: string): Promise<DeviceHolding[]> {
    return (
      this.db
        .select({
          informationAssetId: informationAssets.id,
          reference: informationAssets.reference,
          name: informationAssets.name,
          classification: informationAssets.classification,
          classificationRank: classificationLevels.rank,
          personalData: informationAssets.personalData,
          ownerId: informationAssets.ownerId,
        })
        .from(informationAssetDevices)
        .innerJoin(
          informationAssets,
          eq(informationAssets.id, informationAssetDevices.informationAssetId),
        )
        .innerJoin(
          classificationLevels,
          eq(classificationLevels.code, informationAssets.classification),
        )
        .where(eq(informationAssetDevices.deviceAssetId, deviceAssetId))
        // Worst first: the first line of the answer is the one that decides whether a lost device is
        // an incident. Retired assets are INCLUDED — a device disposed of last year still held them,
        // and that is the whole point of being asked.
        .orderBy(
          desc(classificationLevels.rank),
          asc(informationAssets.name),
          asc(informationAssets.id),
        )
    );
  }

  async classificationSummary(): Promise<ClassificationSummaryLine[]> {
    return (
      this.db
        .select({
          classification: classificationLevels.code,
          rank: classificationLevels.rank,
          // Counted over the JOINED asset id, not `count(*)`: a level with no assets must report zero
          // rather than one, which is what `count(*)` would give for the level row itself.
          assets: sql<number>`count(${informationAssets.id})::int`,
          personalDataAssets: sql<number>`
          count(${informationAssets.id}) FILTER (WHERE ${informationAssets.personalData})::int
        `,
          onDevices: sql<number>`
          count(${informationAssets.id}) FILTER (WHERE ${DEVICE_COUNT} > 0)::int
        `,
        })
        .from(classificationLevels)
        // LEFT, and from the LEVELS side: "we hold nothing restricted" is an answer worth printing,
        // and joining the other way would omit the line entirely.
        .leftJoin(
          informationAssets,
          and(
            eq(informationAssets.classification, classificationLevels.code),
            isNull(informationAssets.retiredAt),
          ),
        )
        .groupBy(classificationLevels.code, classificationLevels.rank)
        // `code` last for the same reason as `listLevels` — the PK makes the order total.
        .orderBy(desc(classificationLevels.rank), asc(classificationLevels.code))
    );
  }
}

/**
 * The register's own columns, named explicitly.
 *
 * `list` projects extra columns alongside them, and Drizzle's `select()` with no argument would
 * return the joined shape nested under table keys instead. Spelling them out once here keeps the
 * flat row shape that `InformationAssetRow` describes.
 */
function informationAssetColumns() {
  return {
    id: informationAssets.id,
    reference: informationAssets.reference,
    name: informationAssets.name,
    description: informationAssets.description,
    type: informationAssets.type,
    classification: informationAssets.classification,
    ownerId: informationAssets.ownerId,
    custodianId: informationAssets.custodianId,
    confidentiality: informationAssets.confidentiality,
    integrity: informationAssets.integrity,
    availability: informationAssets.availability,
    personalData: informationAssets.personalData,
    location: informationAssets.location,
    retentionMonths: informationAssets.retentionMonths,
    lastReviewedAt: informationAssets.lastReviewedAt,
    reviewDueOn: informationAssets.reviewDueOn,
    retiredAt: informationAssets.retiredAt,
    createdAt: informationAssets.createdAt,
    updatedAt: informationAssets.updatedAt,
  };
}
