import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import {
  internalAuditAuditors,
  internalAudits,
  nonconformanceSeverities,
  nonconformances,
} from '../../../../../../db/schema';
import type { IInternalAuditRepository } from '../../domain/ports/qms.repository';
import type {
  AuditFinding,
  AuditRole,
  InternalAudit,
  InternalAuditAuditor,
  InternalAuditFilters,
  InternalAuditRow,
  PlanAuditInput,
  UnlinkedFinding,
  UpdateAuditInput,
} from '../../domain/internal-audit.types';

/**
 * CORRELATED SUBQUERIES ARE WRITTEN WITH EXPLICIT, FULLY QUALIFIED REFERENCES.
 *
 * Drizzle only qualifies a column inside a `sql` template when the OUTER query has a join. Without
 * one, `${capas.nonconformanceId} = ${nonconformances.id}` renders as
 * `WHERE "nonconformance_id" = "id"` — and inside the subquery both bare names bind to the INNER
 * table, so the predicate becomes `capas.nonconformance_id = capas.id` and is always false. The count
 * is then silently 0 rather than an error.
 *
 * This was measured, not guessed: the internal-audit programme reported `findingCount: 0` for an audit
 * that demonstrably had two findings, while the identical shape on the non-conformance register was
 * correct — because THAT query happens to join the severities table. Depending on the presence of a
 * join for correctness means removing a join silently breaks a count somewhere else in the file.
 *
 * So the outer reference is spelled `schema.table.column` and the inner table is aliased. Verbose, and
 * it cannot be broken by a change to the surrounding query.
 */

/** Terminal states. Everything else is still live in the programme. */
const SETTLED_STATUSES = ['closed', 'cancelled'] as const;

/**
 * Roles that count as having AUDITED.
 *
 * `observer` is excluded deliberately: somebody sitting in on fieldwork to learn, or an auditee's
 * representative, has not audited and is not compromised as a later reviewer. The impartiality rule
 * reads this set, so it is defined once here rather than spelled out at each call site.
 */
const AUDITING_ROLES = ['lead', 'auditor'] as const;

/** Findings that still need work. Mirrors the register's own settled set. */
const OPEN_FINDING_STATUSES = ['open', 'contained'] as const;

@Injectable()
export class InternalAuditDrizzleRepository implements IInternalAuditRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: PlanAuditInput, tx?: DbExecutor): Promise<InternalAudit> {
    const [row] = await (tx ?? this.db)
      .insert(internalAudits)
      .values({
        id: newId(),
        reference: input.reference,
        title: input.title,
        objective: input.objective,
        scope: input.scope,
        criteria: input.criteria,
        leadAuditorId: input.leadAuditorId,
        plannedStartOn: input.plannedStartOn ?? null,
        plannedEndOn: input.plannedEndOn ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<InternalAudit | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(internalAudits)
      .where(eq(internalAudits.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<InternalAudit | null> {
    const [row] = await this.db
      .select()
      .from(internalAudits)
      .where(eq(internalAudits.reference, reference))
      .limit(1);
    return row ?? null;
  }

  async list(
    filters: InternalAuditFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: InternalAuditRow[]; total: number }> {
    const where = and(
      filters.status ? eq(internalAudits.status, filters.status) : undefined,
      filters.leadAuditorId ? eq(internalAudits.leadAuditorId, filters.leadAuditorId) : undefined,
      filters.auditorId
        ? sql`EXISTS (
            SELECT 1 FROM qms.internal_audit_auditors aa
            WHERE aa.internal_audit_id = qms.internal_audits.id
              AND aa.auditor_id = ${filters.auditorId}
          )`
        : undefined,
      filters.openOnly ? notInArray(internalAudits.status, [...SETTLED_STATUSES]) : undefined,
      filters.plannedStartOnOrBefore
        ? lte(internalAudits.plannedStartOn, filters.plannedStartOnOrBefore)
        : undefined,
      filters.search
        ? sql`(${internalAudits.title} ILIKE ${'%' + filters.search + '%'}
            OR ${internalAudits.reference} ILIKE ${'%' + filters.search + '%'}
            OR ${internalAudits.scope} ILIKE ${'%' + filters.search + '%'})`
        : undefined,
    );

    const rows = await this.db
      .select({
        ...auditColumns(),
        auditorCount: sql<number>`(
          SELECT count(*)::int FROM qms.internal_audit_auditors aa
          WHERE aa.internal_audit_id = qms.internal_audits.id
            AND aa.role IN ('lead', 'auditor')
        )`,
        findingCount: sql<number>`(
          SELECT count(*)::int FROM qms.nonconformances nc
          WHERE nc.internal_audit_id = qms.internal_audits.id
        )`,
        openFindingCount: sql<number>`(
          SELECT count(*)::int FROM qms.nonconformances nc
          WHERE nc.internal_audit_id = qms.internal_audits.id
            AND nc.status IN ('open', 'contained')
        )`,
      })
      .from(internalAudits)
      .where(where)
      // The programme reads forward: soonest planned start first, undated last. `id` last to make the
      // order total, because a planned date is emphatically not unique — a quarter's audits are
      // commonly planned to the same Monday.
      .orderBy(sql`${internalAudits.plannedStartOn} ASC NULLS LAST`, asc(internalAudits.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(internalAudits)
      .where(where);

    return { rows, total: count };
  }

  async update(
    id: string,
    input: UpdateAuditInput,
    tx?: DbExecutor,
  ): Promise<InternalAudit | null> {
    const [row] = await (tx ?? this.db)
      .update(internalAudits)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(internalAudits.id, id))
      .returning();
    return row ?? null;
  }

  async transition(
    id: string,
    from: InternalAudit['status'],
    to: InternalAudit['status'],
    extra: Partial<
      Pick<
        InternalAudit,
        'startedAt' | 'reportedAt' | 'conclusion' | 'reportDocumentId' | 'closedAt' | 'cancelReason'
      >
    >,
    tx?: DbExecutor,
  ): Promise<InternalAudit | null> {
    const [row] = await (tx ?? this.db)
      .update(internalAudits)
      .set({ status: to, ...extra, updatedAt: new Date() })
      // The FROM state is in the WHERE clause, so two people reporting the same audit is Postgres's
      // decision rather than a race between two reads.
      .where(and(eq(internalAudits.id, id), eq(internalAudits.status, from)))
      .returning();
    return row ?? null;
  }

  // ── The roster ───────────────────────────────────────────────────────────────

  async upsertAuditor(
    internalAuditId: string,
    auditorId: string,
    role: AuditRole,
    addedBy: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(internalAuditAuditors)
      .values({ internalAuditId, auditorId, role, addedBy })
      // Re-adding somebody CHANGES their role rather than failing: swapping an observer onto the
      // audit team is one action to the person doing it, and a 409 would make them remove first.
      .onConflictDoUpdate({
        target: [internalAuditAuditors.internalAuditId, internalAuditAuditors.auditorId],
        set: { role, addedBy },
      });
  }

  async removeAuditor(
    internalAuditId: string,
    auditorId: string,
    tx?: DbExecutor,
  ): Promise<boolean> {
    const removed = await (tx ?? this.db)
      .delete(internalAuditAuditors)
      .where(
        and(
          eq(internalAuditAuditors.internalAuditId, internalAuditId),
          eq(internalAuditAuditors.auditorId, auditorId),
        ),
      )
      .returning();
    return removed.length > 0;
  }

  async listAuditors(internalAuditId: string): Promise<InternalAuditAuditor[]> {
    return (
      this.db
        .select()
        .from(internalAuditAuditors)
        .where(eq(internalAuditAuditors.internalAuditId, internalAuditId))
        // Lead first — the enum's declaration order happens to give that, so the ordering is stated
        // explicitly instead. `auditorId` last: the pair is the primary key, so this is total.
        .orderBy(
          sql`CASE ${internalAuditAuditors.role}
          WHEN 'lead' THEN 0 WHEN 'auditor' THEN 1 ELSE 2 END`,
          asc(internalAuditAuditors.auditorId),
        )
    );
  }

  async didAudit(internalAuditId: string, personId: string, tx?: DbExecutor): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ one: sql<number>`1` })
      .from(internalAuditAuditors)
      .where(
        and(
          eq(internalAuditAuditors.internalAuditId, internalAuditId),
          eq(internalAuditAuditors.auditorId, personId),
          inArray(internalAuditAuditors.role, [...AUDITING_ROLES]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  // ── Findings ─────────────────────────────────────────────────────────────────

  async listFindings(internalAuditId: string): Promise<AuditFinding[]> {
    return (
      this.db
        .select({
          id: nonconformances.id,
          reference: nonconformances.reference,
          title: nonconformances.title,
          severity: nonconformances.severity,
          severityRank: nonconformanceSeverities.rank,
          status: nonconformances.status,
          ownerId: nonconformances.ownerId,
          detectedAt: nonconformances.detectedAt,
        })
        .from(nonconformances)
        .innerJoin(
          nonconformanceSeverities,
          eq(nonconformanceSeverities.code, nonconformances.severity),
        )
        .where(eq(nonconformances.internalAuditId, internalAuditId))
        // Worst grade first — an audit report is read that way. `id` last for a total order.
        .orderBy(
          desc(nonconformanceSeverities.rank),
          asc(nonconformances.detectedAt),
          asc(nonconformances.id),
        )
    );
  }

  async unlinkedFindings(limit: number): Promise<UnlinkedFinding[]> {
    return (
      this.db
        .select({
          id: nonconformances.id,
          reference: nonconformances.reference,
          title: nonconformances.title,
          severity: nonconformances.severity,
          processArea: nonconformances.processArea,
          detectedAt: nonconformances.detectedAt,
          raisedBy: nonconformances.raisedBy,
        })
        .from(nonconformances)
        .innerJoin(
          nonconformanceSeverities,
          eq(nonconformanceSeverities.code, nonconformances.severity),
        )
        .where(
          and(
            // Only findings that CLAIM to come from an internal audit. One sourced from a customer
            // complaint has no audit to name, so it is not a gap.
            eq(nonconformances.source, 'internal_audit'),
            isNull(nonconformances.internalAuditId),
            // A voided finding needs no traceability — it was raised in error.
            notInArray(nonconformances.status, ['void']),
          ),
        )
        // Oldest first: the longer a finding has gone untraceable, the worse the hole.
        .orderBy(asc(nonconformances.detectedAt), asc(nonconformances.id))
        .limit(limit)
    );
  }
}

function auditColumns() {
  return {
    id: internalAudits.id,
    reference: internalAudits.reference,
    title: internalAudits.title,
    objective: internalAudits.objective,
    scope: internalAudits.scope,
    criteria: internalAudits.criteria,
    status: internalAudits.status,
    leadAuditorId: internalAudits.leadAuditorId,
    plannedStartOn: internalAudits.plannedStartOn,
    plannedEndOn: internalAudits.plannedEndOn,
    startedAt: internalAudits.startedAt,
    reportedAt: internalAudits.reportedAt,
    conclusion: internalAudits.conclusion,
    reportDocumentId: internalAudits.reportDocumentId,
    closedAt: internalAudits.closedAt,
    cancelReason: internalAudits.cancelReason,
    createdAt: internalAudits.createdAt,
    updatedAt: internalAudits.updatedAt,
  };
}

/** Whether an audit has finished. Shared with the service's guards for the same reason as the others. */
export const isSettledAudit = (status: InternalAudit['status']): boolean =>
  (SETTLED_STATUSES as readonly string[]).includes(status);

/** Whether a finding still needs work. Exported so the roster and the register agree on "open". */
export const isOpenFinding = (status: string): boolean =>
  (OPEN_FINDING_STATUSES as readonly string[]).includes(status);
