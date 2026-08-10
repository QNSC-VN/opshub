import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, notExists, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { controls, riskControls, risks, soaEntries } from '../../../../../../db/schema';
import type { IControlRepository } from '../../domain/ports/control.repository';
import type {
  Control,
  ControlFilters,
  CreateControlInput,
  SetSoaEntryInput,
  SoaCoverage,
  SoaEntry,
  SoaFilters,
  SoaRow,
  UntreatedRisk,
  UpdateControlInput,
} from '../../domain/control.types';

/** Risk states that still represent live exposure — a closed risk needs no control. */
const OPEN_RISK_STATUSES = ['identified', 'assessed', 'treated', 'accepted'] as const;

@Injectable()
export class ControlDrizzleRepository implements IControlRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── Catalogue ────────────────────────────────────────────────────────────────

  async createControl(input: CreateControlInput, tx?: DbExecutor): Promise<Control> {
    const [row] = await (tx ?? this.db)
      .insert(controls)
      .values({
        id: newId(),
        reference: input.reference,
        title: input.title,
        description: input.description ?? null,
        theme: input.theme,
        source: input.source ?? 'annex_a',
      })
      .returning();
    return row;
  }

  async findControlById(id: string, tx?: DbExecutor): Promise<Control | null> {
    const [row] = await (tx ?? this.db).select().from(controls).where(eq(controls.id, id)).limit(1);
    return row ?? null;
  }

  async findControlByReference(reference: string): Promise<Control | null> {
    const [row] = await this.db
      .select()
      .from(controls)
      .where(eq(controls.reference, reference))
      .limit(1);
    return row ?? null;
  }

  async listControls(
    filters: ControlFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Control[]; total: number }> {
    const where = and(
      filters.theme ? eq(controls.theme, filters.theme) : undefined,
      filters.source ? eq(controls.source, filters.source) : undefined,
      filters.includeRetired ? undefined : isNull(controls.retiredAt),
    );

    const rows = await this.db
      .select()
      .from(controls)
      .where(where)
      // `reference` is unique; `id` is the tiebreaker the ordering ratchet can verify from source.
      .orderBy(asc(controls.reference), asc(controls.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(controls)
      .where(where);

    return { rows, total: count };
  }

  async updateControl(
    id: string,
    input: UpdateControlInput,
    tx?: DbExecutor,
  ): Promise<Control | null> {
    const [row] = await (tx ?? this.db)
      .update(controls)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(controls.id, id))
      .returning();
    return row ?? null;
  }

  async retireControl(id: string, tx?: DbExecutor): Promise<Control | null> {
    const [row] = await (tx ?? this.db)
      .update(controls)
      .set({ retiredAt: new Date(), updatedAt: new Date() })
      // Not-yet-retired only: retiring twice would rewrite the date, and a read-then-write check
      // could be raced.
      .where(and(eq(controls.id, id), isNull(controls.retiredAt)))
      .returning();
    return row ?? null;
  }

  // ── Statement of Applicability ───────────────────────────────────────────────

  async findEntryByControl(controlId: string, tx?: DbExecutor): Promise<SoaEntry | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(soaEntries)
      .where(eq(soaEntries.controlId, controlId))
      .limit(1);
    return row ?? null;
  }

  async upsertEntry(
    controlId: string,
    input: SetSoaEntryInput,
    tx?: DbExecutor,
  ): Promise<SoaEntry> {
    const values = {
      applicable: input.applicable,
      justification: input.justification,
      status: input.status,
      implementationNote: input.implementationNote ?? null,
      evidenceDocumentId: input.evidenceDocumentId ?? null,
      ownerId: input.ownerId ?? null,
      reviewDueOn: input.reviewDueOn ?? null,
    };

    const [row] = await (tx ?? this.db)
      .insert(soaEntries)
      .values({ id: newId(), controlId, ...values })
      // One statement per control, so the conflict target is `uq_soa_control` and the last writer
      // wins. A read-then-branch would let two concurrent writers both find nothing.
      .onConflictDoUpdate({
        target: soaEntries.controlId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async listEntries(
    filters: SoaFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoaRow[]; total: number }> {
    const where = and(
      filters.applicable === undefined ? undefined : eq(soaEntries.applicable, filters.applicable),
      filters.status ? eq(soaEntries.status, filters.status) : undefined,
      filters.ownerId ? eq(soaEntries.ownerId, filters.ownerId) : undefined,
      filters.theme ? eq(controls.theme, filters.theme) : undefined,
      filters.reviewDueOnOrBefore
        ? lte(soaEntries.reviewDueOn, filters.reviewDueOnOrBefore)
        : undefined,
    );

    const rows = await this.db
      .select({
        id: soaEntries.id,
        controlId: soaEntries.controlId,
        applicable: soaEntries.applicable,
        justification: soaEntries.justification,
        status: soaEntries.status,
        implementationNote: soaEntries.implementationNote,
        evidenceDocumentId: soaEntries.evidenceDocumentId,
        ownerId: soaEntries.ownerId,
        lastReviewedAt: soaEntries.lastReviewedAt,
        reviewDueOn: soaEntries.reviewDueOn,
        createdAt: soaEntries.createdAt,
        updatedAt: soaEntries.updatedAt,
        controlReference: controls.reference,
        controlTitle: controls.title,
        controlTheme: controls.theme,
      })
      .from(soaEntries)
      .innerJoin(controls, eq(controls.id, soaEntries.controlId))
      .where(where)
      // By control reference, which is how the SoA is read and exported. `id` is the tiebreaker.
      .orderBy(asc(controls.reference), asc(soaEntries.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(soaEntries)
      .innerJoin(controls, eq(controls.id, soaEntries.controlId))
      .where(where);

    return { rows, total: count };
  }

  async markReviewed(
    controlId: string,
    reviewDueOn: string | null,
    tx?: DbExecutor,
  ): Promise<SoaEntry | null> {
    const [row] = await (tx ?? this.db)
      .update(soaEntries)
      .set({
        lastReviewedAt: new Date(),
        ...(reviewDueOn === null ? {} : { reviewDueOn }),
        updatedAt: new Date(),
      })
      .where(eq(soaEntries.controlId, controlId))
      .returning();
    return row ?? null;
  }

  // ── Risk ↔ control ───────────────────────────────────────────────────────────

  async linkRiskControl(
    riskId: string,
    controlId: string,
    linkedBy: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(riskControls)
      .values({ riskId, controlId, linkedBy })
      // The natural key makes linking twice idempotent rather than a 500.
      .onConflictDoNothing();
  }

  async unlinkRiskControl(riskId: string, controlId: string, tx?: DbExecutor): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .delete(riskControls)
      .where(and(eq(riskControls.riskId, riskId), eq(riskControls.controlId, controlId)))
      .returning();
    return rows.length > 0;
  }

  async listControlsForRisk(riskId: string): Promise<(Control & { status: string | null })[]> {
    return this.db
      .select({
        id: controls.id,
        reference: controls.reference,
        title: controls.title,
        description: controls.description,
        theme: controls.theme,
        source: controls.source,
        retiredAt: controls.retiredAt,
        createdAt: controls.createdAt,
        updatedAt: controls.updatedAt,
        // Left-joined: a control may be linked before anybody has written its SoA entry, and the
        // null is the honest answer rather than a default that reads as a decision.
        status: soaEntries.status,
      })
      .from(riskControls)
      .innerJoin(controls, eq(controls.id, riskControls.controlId))
      .leftJoin(soaEntries, eq(soaEntries.controlId, controls.id))
      .where(eq(riskControls.riskId, riskId))
      .orderBy(asc(controls.reference), asc(controls.id));
  }

  async listRisksForControl(
    controlId: string,
  ): Promise<{ id: string; reference: string; title: string }[]> {
    return this.db
      .select({ id: risks.id, reference: risks.reference, title: risks.title })
      .from(riskControls)
      .innerJoin(risks, eq(risks.id, riskControls.riskId))
      .where(eq(riskControls.controlId, controlId))
      .orderBy(asc(risks.reference), asc(risks.id));
  }

  // ── Reports ──────────────────────────────────────────────────────────────────

  async soaCoverage(): Promise<SoaCoverage> {
    // One query over the catalogue, left-joined to its decisions. `FILTER` rather than several
    // round trips, and `undecided` counts the controls with NO entry — the state only an absent row
    // can express.
    const [row] = await this.db
      .select({
        totalControls: sql<number>`count(*)::int`,
        undecided: sql<number>`count(*) FILTER (WHERE ${soaEntries.id} IS NULL)::int`,
        applicable: sql<number>`count(*) FILTER (WHERE ${soaEntries.applicable} = true)::int`,
        excluded: sql<number>`count(*) FILTER (WHERE ${soaEntries.applicable} = false)::int`,
        implemented: sql<number>`count(*) FILTER (WHERE ${soaEntries.status} = 'implemented')::int`,
        partiallyImplemented: sql<number>`count(*) FILTER (WHERE ${soaEntries.status} = 'partially_implemented')::int`,
        notImplemented: sql<number>`count(*) FILTER (WHERE ${soaEntries.status} = 'not_implemented')::int`,
      })
      .from(controls)
      .leftJoin(soaEntries, eq(soaEntries.controlId, controls.id))
      // A retired control is not part of the current statement, so counting it would understate
      // coverage against a catalogue nobody is working from.
      .where(isNull(controls.retiredAt));

    return row;
  }

  async untreatedRisks(limit: number): Promise<UntreatedRisk[]> {
    return (
      this.db
        .select({
          riskId: risks.id,
          reference: risks.reference,
          title: risks.title,
          status: risks.status,
          inherentScore: risks.inherentScore,
          residualScore: risks.residualScore,
        })
        .from(risks)
        .where(
          and(
            inArray(risks.status, [...OPEN_RISK_STATUSES]),
            // Anti-join: a risk with no row in the link table at all.
            notExists(
              this.db
                .select({ one: sql`1` })
                .from(riskControls)
                .where(eq(riskControls.riskId, risks.id)),
            ),
          ),
        )
        // Worst first — the same ordering the register uses, for the same reason.
        .orderBy(sql`${risks.inherentScore} DESC`, asc(risks.id))
        .limit(limit)
    );
  }
}
