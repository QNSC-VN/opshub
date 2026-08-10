import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { capas, nonconformanceSeverities, nonconformances } from '../../../../../../db/schema';
import type { INonconformanceRepository } from '../../domain/ports/qms.repository';
import type {
  ContainmentOverdue,
  Nonconformance,
  NonconformanceFilters,
  NonconformanceRow,
  NonconformanceSeverityLevel,
  RaiseNonconformanceInput,
  RecurrenceSignal,
  UpdateNonconformanceInput,
} from '../../domain/qms.types';

/** Terminal states. Everything else is still being worked. */
const SETTLED_STATUSES = ['closed', 'void'] as const;

/**
 * `detected_at + the grade's containment days`, as a date.
 *
 * Derived here and nowhere else. It cannot be a generated column twice over: the interval lives in
 * another table, and `timestamptz + interval` is only STABLE while a generated column must be
 * IMMUTABLE. Keeping it in one expression is what stops the arithmetic being repeated — and what
 * makes the register's column and the overdue report agree by construction.
 */
const CONTAINMENT_DUE = sql`(
  ${nonconformances.detectedAt}
  + (${nonconformanceSeverities.containmentDueDays} * interval '1 day')
)::date`;

@Injectable()
export class NonconformanceDrizzleRepository implements INonconformanceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async listSeverities(): Promise<NonconformanceSeverityLevel[]> {
    return (
      this.db
        .select()
        .from(nonconformanceSeverities)
        // `rank` is UNIQUE, so this already orders totally — `code` is appended because it is the
        // PRIMARY KEY, making the total order structural rather than something to go and confirm.
        .orderBy(asc(nonconformanceSeverities.rank), asc(nonconformanceSeverities.code))
    );
  }

  async create(
    input: RaiseNonconformanceInput & { raisedBy: string },
    tx?: DbExecutor,
  ): Promise<Nonconformance> {
    const [row] = await (tx ?? this.db)
      .insert(nonconformances)
      .values({
        id: newId(),
        reference: input.reference,
        title: input.title,
        description: input.description,
        requirement: input.requirement,
        source: input.source,
        severity: input.severity,
        processArea: input.processArea,
        ownerId: input.ownerId,
        raisedBy: input.raisedBy,
        detectedAt: input.detectedAt ? new Date(input.detectedAt) : new Date(),
        incidentId: input.incidentId ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<Nonconformance | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(nonconformances)
      .where(eq(nonconformances.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<Nonconformance | null> {
    const [row] = await this.db
      .select()
      .from(nonconformances)
      .where(eq(nonconformances.reference, reference))
      .limit(1);
    return row ?? null;
  }

  async list(
    filters: NonconformanceFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: NonconformanceRow[]; total: number }> {
    const where = and(
      filters.status ? eq(nonconformances.status, filters.status) : undefined,
      filters.severity ? eq(nonconformances.severity, filters.severity) : undefined,
      filters.source ? eq(nonconformances.source, filters.source) : undefined,
      filters.ownerId ? eq(nonconformances.ownerId, filters.ownerId) : undefined,
      filters.processArea ? eq(nonconformances.processArea, filters.processArea) : undefined,
      filters.openOnly ? notInArray(nonconformances.status, [...SETTLED_STATUSES]) : undefined,
      filters.capaRequiredOnly ? eq(nonconformanceSeverities.requiresCapa, true) : undefined,
      filters.search
        ? sql`(${nonconformances.title} ILIKE ${'%' + filters.search + '%'}
            OR ${nonconformances.reference} ILIKE ${'%' + filters.search + '%'}
            OR ${nonconformances.requirement} ILIKE ${'%' + filters.search + '%'})`
        : undefined,
    );

    const rows = await this.db
      .select({
        ...nonconformanceColumns(),
        severityRank: nonconformanceSeverities.rank,
        requiresCapa: nonconformanceSeverities.requiresCapa,
        containmentDueDays: nonconformanceSeverities.containmentDueDays,
        capaCount: sql<number>`(
          SELECT count(*)::int FROM ${capas}
          WHERE ${capas.nonconformanceId} = ${nonconformances.id}
        )`,
        verifiedCapaCount: sql<number>`(
          SELECT count(*)::int FROM ${capas}
          WHERE ${capas.nonconformanceId} = ${nonconformances.id} AND ${capas.status} = 'verified'
        )`,
        // Null once contained: a deadline that has been met is not a deadline any more, and leaving
        // it populated is how a screen shows a red date next to a finished job.
        containmentDueOn: sql<string | null>`CASE
          WHEN ${nonconformances.containedAt} IS NULL
          THEN to_char(${CONTAINMENT_DUE}, 'YYYY-MM-DD') END`,
      })
      .from(nonconformances)
      // INNER, and it cannot drop a row: `severity` is an FK to this table and NOT NULL.
      .innerJoin(
        nonconformanceSeverities,
        eq(nonconformanceSeverities.code, nonconformances.severity),
      )
      .where(where)
      // Worst grade first, then oldest detection: the queue question is always "what is the most
      // serious thing that has been open longest". Ranked by the SEVERITIES TABLE, never by the
      // enum's declaration order. `id` last, because neither rank nor a timestamp is unique.
      .orderBy(
        desc(nonconformanceSeverities.rank),
        asc(nonconformances.detectedAt),
        asc(nonconformances.id),
      )
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(nonconformances)
      .innerJoin(
        nonconformanceSeverities,
        eq(nonconformanceSeverities.code, nonconformances.severity),
      )
      .where(where);

    return { rows, total: count };
  }

  async update(
    id: string,
    input: UpdateNonconformanceInput,
    tx?: DbExecutor,
  ): Promise<Nonconformance | null> {
    const { detectedAt, ...rest } = input;
    const [row] = await (tx ?? this.db)
      .update(nonconformances)
      .set({
        ...rest,
        ...(detectedAt === undefined ? {} : { detectedAt: new Date(detectedAt) }),
        updatedAt: new Date(),
      })
      .where(eq(nonconformances.id, id))
      .returning();
    return row ?? null;
  }

  async transition(
    id: string,
    from: Nonconformance['status'],
    to: Nonconformance['status'],
    extra: Partial<
      Pick<
        Nonconformance,
        'containmentAction' | 'containedAt' | 'closedAt' | 'closureNote' | 'closedBy' | 'voidReason'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Nonconformance | null> {
    const [row] = await (tx ?? this.db)
      .update(nonconformances)
      .set({ status: to, ...extra, updatedAt: new Date() })
      // The FROM state is in the WHERE clause, so two people closing the same finding is Postgres's
      // decision rather than a race between two reads.
      .where(and(eq(nonconformances.id, id), eq(nonconformances.status, from)))
      .returning();
    return row ?? null;
  }

  // ── Reports ──────────────────────────────────────────────────────────────────

  async containmentOverdue(limit: number): Promise<ContainmentOverdue[]> {
    return (
      this.db
        .select({
          id: nonconformances.id,
          reference: nonconformances.reference,
          title: nonconformances.title,
          severity: nonconformances.severity,
          severityRank: nonconformanceSeverities.rank,
          processArea: nonconformances.processArea,
          ownerId: nonconformances.ownerId,
          detectedAt: nonconformances.detectedAt,
          dueOn: sql<string>`to_char(${CONTAINMENT_DUE}, 'YYYY-MM-DD')`,
          // Computed alongside the row so nothing downstream recalculates it.
          daysOverdue: sql<number>`(current_date - ${CONTAINMENT_DUE})::int`,
        })
        .from(nonconformances)
        .innerJoin(
          nonconformanceSeverities,
          eq(nonconformanceSeverities.code, nonconformances.severity),
        )
        .where(
          and(
            // Only findings still awaiting containment. A closed or voided one needs nothing, and a
            // contained one met the deadline by definition.
            eq(nonconformances.status, 'open'),
            sql`${CONTAINMENT_DUE} < current_date`,
          ),
        )
        // Most overdue first, then worst grade. `id` last to make the order total.
        .orderBy(asc(CONTAINMENT_DUE), desc(nonconformanceSeverities.rank), asc(nonconformances.id))
        .limit(limit)
    );
  }

  async recurrenceSignals(limit: number): Promise<RecurrenceSignal[]> {
    /**
     * A finding raised AFTER a CAPA in the same process area was verified effective.
     *
     * The comparison is what makes this a signal rather than a count: two findings in one area is
     * ordinary, but a finding that arrives after somebody signed off a fix for that area means the
     * effectiveness review was wrong. That is exactly what ISO 9001 §10.2(d) asks to be reviewed, and
     * it needs BOTH dates — so it is one query rather than a number on a dashboard.
     *
     * Raw SQL because of the window function: `row_number()` keeps one row per area (the latest
     * recurrence) and Drizzle's builder cannot express that without a subquery per column. Read back
     * through `.rows`, which is what `execute` returns.
     */
    const result = await this.db.execute(sql`
      WITH verified AS (
        SELECT n.process_area, max(c.verified_at) AS verified_at
        FROM qms.capas c
        JOIN qms.nonconformances n ON n.id = c.nonconformance_id
        WHERE c.status = 'verified'
        GROUP BY n.process_area
      ),
      recurred AS (
        SELECT
          n.process_area,
          n.reference,
          n.detected_at,
          v.verified_at,
          row_number() OVER (
            PARTITION BY n.process_area ORDER BY n.detected_at DESC, n.id DESC
          ) AS row_num
        FROM qms.nonconformances n
        JOIN verified v ON v.process_area = n.process_area
        WHERE n.detected_at > v.verified_at
          AND n.status <> 'void'
      )
      SELECT
        r.process_area AS "processArea",
        (SELECT count(*)::int FROM qms.nonconformances n2
          WHERE n2.process_area = r.process_area AND n2.status <> 'void') AS "findings",
        (SELECT count(*)::int FROM qms.capas c2
          JOIN qms.nonconformances n3 ON n3.id = c2.nonconformance_id
          WHERE n3.process_area = r.process_area AND c2.status = 'verified') AS "verifiedCapas",
        r.reference    AS "latestReference",
        r.detected_at  AS "latestDetectedAt",
        r.verified_at  AS "earlierCapaVerifiedAt"
      FROM recurred r
      WHERE r.row_num = 1
      -- Most recent recurrence first, then the area name so the order is total.
      ORDER BY r.detected_at DESC, r.process_area ASC
      LIMIT ${limit}
    `);
    return (result as unknown as { rows: RecurrenceSignal[] }).rows;
  }
}

/**
 * The register's own columns, named explicitly.
 *
 * `list` projects extra columns alongside them, and Drizzle's `select()` with no argument would
 * return the joined shape nested under table keys instead.
 */
function nonconformanceColumns() {
  return {
    id: nonconformances.id,
    reference: nonconformances.reference,
    title: nonconformances.title,
    description: nonconformances.description,
    requirement: nonconformances.requirement,
    source: nonconformances.source,
    severity: nonconformances.severity,
    status: nonconformances.status,
    processArea: nonconformances.processArea,
    ownerId: nonconformances.ownerId,
    detectedAt: nonconformances.detectedAt,
    raisedBy: nonconformances.raisedBy,
    incidentId: nonconformances.incidentId,
    evidenceDocumentId: nonconformances.evidenceDocumentId,
    containmentAction: nonconformances.containmentAction,
    containedAt: nonconformances.containedAt,
    closedAt: nonconformances.closedAt,
    closureNote: nonconformances.closureNote,
    closedBy: nonconformances.closedBy,
    voidReason: nonconformances.voidReason,
    createdAt: nonconformances.createdAt,
    updatedAt: nonconformances.updatedAt,
  };
}

/**
 * Whether a finding has finished being worked.
 *
 * Exported so the repository's "open" filter and the service's "cannot change a settled finding"
 * guard cannot disagree about what settled means — the same arrangement `isTerminalIncidentStatus`
 * uses in the incident module.
 */
export const isSettledNonconformance = (status: Nonconformance['status']): boolean =>
  (SETTLED_STATUSES as readonly string[]).includes(status);
