import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { riskTreatments, risks } from '../../../../../../db/schema';
import type { IRiskRepository } from '../../domain/ports/risk.repository';
import type {
  AddTreatmentInput,
  IdentifyRiskInput,
  Risk,
  RiskFilters,
  RiskTreatment,
  UpdateRiskInput,
  UpdateTreatmentInput,
} from '../../domain/risk.types';

/** Treatments that still represent outstanding work. `cancelled` does not. */
const OUTSTANDING_TREATMENT_STATUSES = ['planned', 'in_progress'] as const;

@Injectable()
export class RiskDrizzleRepository implements IRiskRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── Risks ────────────────────────────────────────────────────────────────────

  async create(input: IdentifyRiskInput, tx?: DbExecutor): Promise<Risk> {
    const [row] = await (tx ?? this.db)
      .insert(risks)
      .values({
        id: newId(),
        reference: input.reference,
        title: input.title,
        description: input.description,
        category: input.category,
        assetId: input.assetId ?? null,
        ownerId: input.ownerId,
        inherentLikelihood: input.inherent.likelihood,
        inherentImpact: input.inherent.impact,
        reviewDueOn: input.reviewDueOn ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<Risk | null> {
    const [row] = await (tx ?? this.db).select().from(risks).where(eq(risks.id, id)).limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<Risk | null> {
    const [row] = await this.db.select().from(risks).where(eq(risks.reference, reference)).limit(1);
    return row ?? null;
  }

  async list(
    filters: RiskFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Risk[]; total: number }> {
    const where = and(
      filters.status ? eq(risks.status, filters.status) : undefined,
      filters.category ? eq(risks.category, filters.category) : undefined,
      filters.ownerId ? eq(risks.ownerId, filters.ownerId) : undefined,
      filters.assetId ? eq(risks.assetId, filters.assetId) : undefined,
      filters.minInherentScore !== undefined
        ? gte(risks.inherentScore, filters.minInherentScore)
        : undefined,
      // The review-due queue: a closed risk has no review, so the status set is implied by the
      // filter rather than left to the caller to remember.
      filters.reviewDueOnOrBefore
        ? and(
            inArray(risks.status, ['identified', 'assessed', 'treated', 'accepted']),
            lte(risks.reviewDueOn, filters.reviewDueOnOrBefore),
          )
        : undefined,
    );

    const rows = await this.db
      .select()
      .from(risks)
      .where(where)
      // Worst first — the register's whole purpose. `id` last because `inherent_score` is very much
      // not unique: a 5x5 matrix has 25 possible values, so ties are the norm rather than the edge.
      //
      // DESC on the tiebreaker, so that within one score the most recently RAISED risk is first. `id` is
      // a uuidv7, so `asc` meant oldest-first: with dozens of risks sharing the top score, a risk raised
      // today sorted behind every one of them and could be pages deep in its own band. Same fault, same
      // fix, as the performance cycle list.
      .orderBy(desc(risks.inherentScore), desc(risks.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(risks)
      .where(where);

    return { rows, total: count };
  }

  async update(id: string, input: UpdateRiskInput, tx?: DbExecutor): Promise<Risk | null> {
    const { inherent, ...rest } = input;
    const [row] = await (tx ?? this.db)
      .update(risks)
      .set({
        ...rest,
        ...(inherent
          ? { inherentLikelihood: inherent.likelihood, inherentImpact: inherent.impact }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(risks.id, id))
      .returning();
    return row ?? null;
  }

  async transition(
    id: string,
    from: Risk['status'],
    to: Risk['status'],
    extra: Partial<
      Pick<
        Risk,
        | 'treatmentDecision'
        | 'residualLikelihood'
        | 'residualImpact'
        | 'acceptedBy'
        | 'acceptedAt'
        | 'acceptanceJustification'
        | 'acceptedViaRequestId'
        | 'closedAt'
        | 'closureNote'
        | 'reviewDueOn'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Risk | null> {
    const [row] = await (tx ?? this.db)
      .update(risks)
      .set({ status: to, ...extra, updatedAt: new Date() })
      // The FROM state is in the WHERE clause, not checked beforehand: two concurrent callers would
      // both pass a read-then-write, and only one can win an UPDATE.
      .where(and(eq(risks.id, id), eq(risks.status, from)))
      .returning();
    return row ?? null;
  }

  // ── Treatments ───────────────────────────────────────────────────────────────

  async addTreatment(input: AddTreatmentInput, tx?: DbExecutor): Promise<RiskTreatment> {
    const [row] = await (tx ?? this.db)
      .insert(riskTreatments)
      .values({
        id: newId(),
        riskId: input.riskId,
        description: input.description,
        ownerId: input.ownerId,
        dueOn: input.dueOn ?? null,
      })
      .returning();
    return row;
  }

  async findTreatmentById(id: string, tx?: DbExecutor): Promise<RiskTreatment | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(riskTreatments)
      .where(eq(riskTreatments.id, id))
      .limit(1);
    return row ?? null;
  }

  async listTreatments(riskId: string): Promise<RiskTreatment[]> {
    return this.db
      .select()
      .from(riskTreatments)
      .where(eq(riskTreatments.riskId, riskId))
      .orderBy(asc(riskTreatments.dueOn), asc(riskTreatments.id));
  }

  async updateTreatment(
    id: string,
    input: UpdateTreatmentInput,
    tx?: DbExecutor,
  ): Promise<RiskTreatment | null> {
    const [row] = await (tx ?? this.db)
      .update(riskTreatments)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(riskTreatments.id, id))
      .returning();
    return row ?? null;
  }

  async countOutstandingTreatments(riskId: string, tx?: DbExecutor): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({ count: sql<number>`count(*)::int` })
      .from(riskTreatments)
      .where(
        and(
          eq(riskTreatments.riskId, riskId),
          inArray(riskTreatments.status, [...OUTSTANDING_TREATMENT_STATUSES]),
        ),
      );
    return row?.count ?? 0;
  }
}
