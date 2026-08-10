import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lte, notInArray, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { capas, nonconformances } from '../../../../../../db/schema';
import type { ICapaRepository } from '../../domain/ports/qms.repository';
import type {
  Capa,
  CapaAnalysisInput,
  CapaFilters,
  CapaRow,
  OpenCapaInput,
} from '../../domain/qms.types';

/** Terminal states. Everything else is still being worked. */
const SETTLED_STATUSES = ['verified', 'cancelled'] as const;

@Injectable()
export class CapaDrizzleRepository implements ICapaRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(nonconformanceId: string, input: OpenCapaInput, tx?: DbExecutor): Promise<Capa> {
    const [row] = await (tx ?? this.db)
      .insert(capas)
      .values({
        id: newId(),
        reference: input.reference,
        nonconformanceId,
        ownerId: input.ownerId,
        dueOn: input.dueOn ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<Capa | null> {
    const [row] = await (tx ?? this.db).select().from(capas).where(eq(capas.id, id)).limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<Capa | null> {
    const [row] = await this.db.select().from(capas).where(eq(capas.reference, reference)).limit(1);
    return row ?? null;
  }

  async list(
    filters: CapaFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: CapaRow[]; total: number }> {
    const where = and(
      filters.status ? eq(capas.status, filters.status) : undefined,
      filters.ownerId ? eq(capas.ownerId, filters.ownerId) : undefined,
      filters.nonconformanceId ? eq(capas.nonconformanceId, filters.nonconformanceId) : undefined,
      filters.openOnly ? notInArray(capas.status, [...SETTLED_STATUSES]) : undefined,
      filters.dueOnOrBefore ? lte(capas.dueOn, filters.dueOnOrBefore) : undefined,
    );

    const rows = await this.db
      .select({
        ...capaColumns(),
        nonconformanceReference: nonconformances.reference,
        nonconformanceTitle: nonconformances.title,
        nonconformanceSeverity: nonconformances.severity,
      })
      .from(capas)
      // INNER, and it cannot drop a row: `nonconformance_id` is NOT NULL with an FK.
      .innerJoin(nonconformances, eq(nonconformances.id, capas.nonconformanceId))
      .where(where)
      // Soonest due first — the deadline is the only ordering a work queue wants. Nulls last so
      // undated CAPAs do not crowd out the ones with a date. `id` last to make the order total.
      .orderBy(sql`${capas.dueOn} ASC NULLS LAST`, asc(capas.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(capas)
      .where(where);

    return { rows, total: count };
  }

  async listForNonconformance(nonconformanceId: string): Promise<Capa[]> {
    return (
      this.db
        .select()
        .from(capas)
        .where(eq(capas.nonconformanceId, nonconformanceId))
        // Newest first: the current attempt is what a reader wants, earlier ones are context. `id`
        // last, because two CAPAs opened in one script share a timestamp.
        .orderBy(desc(capas.createdAt), desc(capas.id))
    );
  }

  async setAnalysis(id: string, input: CapaAnalysisInput, tx?: DbExecutor): Promise<Capa | null> {
    const [row] = await (tx ?? this.db)
      .update(capas)
      .set({
        rootCause: input.rootCause,
        rootCauseMethod: input.rootCauseMethod,
        actionPlan: input.actionPlan,
        ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
        updatedAt: new Date(),
      })
      .where(eq(capas.id, id))
      .returning();
    return row ?? null;
  }

  async transition(
    id: string,
    from: Capa['status'],
    to: Capa['status'],
    extra: Partial<
      Pick<
        Capa,
        'implementedAt' | 'verifiedAt' | 'verifiedBy' | 'effectivenessEvidence' | 'outcomeNote'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Capa | null> {
    const [row] = await (tx ?? this.db)
      .update(capas)
      .set({ status: to, ...extra, updatedAt: new Date() })
      // The FROM state is in the WHERE clause. Two reviewers signing off the same CAPA is the normal
      // case rather than the edge case, so the race has to be Postgres's decision.
      .where(and(eq(capas.id, id), eq(capas.status, from)))
      .returning();
    return row ?? null;
  }

  async hasVerifiedCapa(nonconformanceId: string, tx?: DbExecutor): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ one: sql<number>`1` })
      .from(capas)
      .where(and(eq(capas.nonconformanceId, nonconformanceId), eq(capas.status, 'verified')))
      .limit(1);
    return row !== undefined;
  }
}

function capaColumns() {
  return {
    id: capas.id,
    reference: capas.reference,
    nonconformanceId: capas.nonconformanceId,
    status: capas.status,
    ownerId: capas.ownerId,
    rootCause: capas.rootCause,
    rootCauseMethod: capas.rootCauseMethod,
    actionPlan: capas.actionPlan,
    dueOn: capas.dueOn,
    implementedAt: capas.implementedAt,
    verifiedAt: capas.verifiedAt,
    verifiedBy: capas.verifiedBy,
    effectivenessEvidence: capas.effectivenessEvidence,
    outcomeNote: capas.outcomeNote,
    createdAt: capas.createdAt,
    updatedAt: capas.updatedAt,
  };
}

/** Whether a CAPA has finished being worked. Shared with the service's guards for the same reason. */
export const isSettledCapa = (status: Capa['status']): boolean =>
  (SETTLED_STATUSES as readonly string[]).includes(status);
