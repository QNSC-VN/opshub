import { Injectable } from '@nestjs/common';
import { and, asc, eq, lte, ne, notInArray, sql } from 'drizzle-orm';
import { InjectDrizzle, type DbExecutor, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { managementReviewActions, managementReviews } from '../../../../../../db/schema';
import type { IManagementReviewRepository } from '../../domain/ports/qms.repository';
import type {
  ActionFilters,
  CarriedForwardAction,
  ManagementReview,
  ManagementReviewAction,
  ManagementReviewRow,
  RaiseActionInput,
  ReviewActionRow,
  ReviewFilters,
  ScheduleReviewInput,
  UpdateActionInput,
  UpdateReviewInput,
} from '../../domain/management-review.types';

/** Terminal review states. */
const SETTLED_REVIEWS = ['closed', 'cancelled'] as const;
/** Terminal action states. */
const SETTLED_ACTIONS = ['completed', 'cancelled'] as const;

/**
 * Correlated subqueries use EXPLICIT, fully qualified references.
 *
 * See the note in `internal-audit.drizzle-repository.ts`: Drizzle only qualifies a column inside a
 * `sql` template when the outer query has a join, and this query has none — so an interpolated
 * `${managementReviews.id}` would render a bare `"id"` that binds to the INNER table and make the
 * count silently 0.
 */
const ACTION_COUNT = sql<number>`(
  SELECT count(*)::int FROM qms.management_review_actions a
  WHERE a.management_review_id = qms.management_reviews.id
)`;
const OPEN_ACTION_COUNT = sql<number>`(
  SELECT count(*)::int FROM qms.management_review_actions a
  WHERE a.management_review_id = qms.management_reviews.id
    AND a.status IN ('open', 'in_progress')
)`;

@Injectable()
export class ManagementReviewDrizzleRepository implements IManagementReviewRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: ScheduleReviewInput, tx?: DbExecutor): Promise<ManagementReview> {
    const [row] = await (tx ?? this.db)
      .insert(managementReviews)
      .values({
        id: newId(),
        reference: input.reference,
        title: input.title,
        period: input.period,
        chairId: input.chairId,
        scheduledFor: input.scheduledFor ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string, tx?: DbExecutor): Promise<ManagementReview | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(managementReviews)
      .where(eq(managementReviews.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByReference(reference: string): Promise<ManagementReview | null> {
    const [row] = await this.db
      .select()
      .from(managementReviews)
      .where(eq(managementReviews.reference, reference))
      .limit(1);
    return row ?? null;
  }

  async list(
    filters: ReviewFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ManagementReviewRow[]; total: number }> {
    const where = and(
      filters.status ? eq(managementReviews.status, filters.status) : undefined,
      filters.chairId ? eq(managementReviews.chairId, filters.chairId) : undefined,
      filters.openOnly ? notInArray(managementReviews.status, [...SETTLED_REVIEWS]) : undefined,
      filters.scheduledOnOrBefore
        ? lte(managementReviews.scheduledFor, filters.scheduledOnOrBefore)
        : undefined,
      filters.search
        ? sql`(${managementReviews.title} ILIKE ${'%' + filters.search + '%'}
            OR ${managementReviews.reference} ILIKE ${'%' + filters.search + '%'}
            OR ${managementReviews.period} ILIKE ${'%' + filters.search + '%'})`
        : undefined,
    );

    const rows = await this.db
      .select({
        ...reviewColumns(),
        actionCount: ACTION_COUNT,
        openActionCount: OPEN_ACTION_COUNT,
      })
      .from(managementReviews)
      .where(where)
      // Soonest scheduled first, undated last — the programme reads forward. `reference` last: it is
      // UNIQUE, so the order is total, and a date is emphatically not (a year's reviews are commonly
      // scheduled to the same month).
      .orderBy(
        sql`${managementReviews.scheduledFor} ASC NULLS LAST`,
        asc(managementReviews.reference),
      )
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(managementReviews)
      .where(where);

    return { rows, total: count };
  }

  async update(
    id: string,
    input: UpdateReviewInput,
    tx?: DbExecutor,
  ): Promise<ManagementReview | null> {
    const [row] = await (tx ?? this.db)
      .update(managementReviews)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(managementReviews.id, id))
      .returning();
    return row ?? null;
  }

  async transition(
    id: string,
    from: ManagementReview['status'],
    to: ManagementReview['status'],
    extra: Partial<
      Pick<
        ManagementReview,
        'heldOn' | 'inputs' | 'conclusion' | 'minutesDocumentId' | 'closedAt' | 'cancelReason'
      >
    >,
    tx?: DbExecutor,
  ): Promise<ManagementReview | null> {
    const [row] = await (tx ?? this.db)
      .update(managementReviews)
      .set({ status: to, ...extra, updatedAt: new Date() })
      // The FROM state is in the WHERE clause, so two people holding the same review is Postgres's
      // decision rather than a race between two reads — and only one of them freezes a snapshot.
      .where(and(eq(managementReviews.id, id), eq(managementReviews.status, from)))
      .returning();
    return row ?? null;
  }

  async earlierOutstanding(review: ManagementReview): Promise<ManagementReview | null> {
    // Undated reviews cannot be "earlier" than anything, so a review with no scheduled date has no
    // ordering to violate.
    if (!review.scheduledFor) return null;

    const [row] = await this.db
      .select()
      .from(managementReviews)
      .where(
        and(
          eq(managementReviews.status, 'scheduled'),
          ne(managementReviews.id, review.id),
          // Strictly earlier by date, or the same date with a lower reference — so the answer does not
          // depend on which of two same-day reviews is read first.
          sql`(${managementReviews.scheduledFor} < ${review.scheduledFor}
            OR (${managementReviews.scheduledFor} = ${review.scheduledFor}
                AND ${managementReviews.reference} < ${review.reference}))`,
        ),
      )
      .orderBy(asc(managementReviews.scheduledFor), asc(managementReviews.reference))
      .limit(1);
    return row ?? null;
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async addAction(
    managementReviewId: string,
    input: RaiseActionInput,
    tx?: DbExecutor,
  ): Promise<ManagementReviewAction> {
    const [row] = await (tx ?? this.db)
      .insert(managementReviewActions)
      .values({
        id: newId(),
        managementReviewId,
        category: input.category,
        description: input.description,
        ownerId: input.ownerId,
        dueOn: input.dueOn ?? null,
      })
      .returning();
    return row;
  }

  async findActionById(id: string, tx?: DbExecutor): Promise<ManagementReviewAction | null> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(managementReviewActions)
      .where(eq(managementReviewActions.id, id))
      .limit(1);
    return row ?? null;
  }

  async listActions(
    filters: ActionFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ReviewActionRow[]; total: number }> {
    const where = and(
      filters.status ? eq(managementReviewActions.status, filters.status) : undefined,
      filters.category ? eq(managementReviewActions.category, filters.category) : undefined,
      filters.ownerId ? eq(managementReviewActions.ownerId, filters.ownerId) : undefined,
      filters.managementReviewId
        ? eq(managementReviewActions.managementReviewId, filters.managementReviewId)
        : undefined,
      filters.openOnly
        ? notInArray(managementReviewActions.status, [...SETTLED_ACTIONS])
        : undefined,
      filters.dueOnOrBefore ? lte(managementReviewActions.dueOn, filters.dueOnOrBefore) : undefined,
    );

    const rows = await this.db
      .select({
        ...actionColumns(),
        reviewReference: managementReviews.reference,
        reviewPeriod: managementReviews.period,
      })
      .from(managementReviewActions)
      // INNER, and it cannot drop a row: `management_review_id` is NOT NULL with an FK.
      .innerJoin(
        managementReviews,
        eq(managementReviews.id, managementReviewActions.managementReviewId),
      )
      .where(where)
      // Soonest due first, undated last — a follow-up list is read by deadline. `id` last for a total
      // order.
      .orderBy(
        sql`${managementReviewActions.dueOn} ASC NULLS LAST`,
        asc(managementReviewActions.id),
      )
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(managementReviewActions)
      .where(where);

    return { rows, total: count };
  }

  async updateAction(
    id: string,
    input: UpdateActionInput,
    tx?: DbExecutor,
  ): Promise<ManagementReviewAction | null> {
    const [row] = await (tx ?? this.db)
      .update(managementReviewActions)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(managementReviewActions.id, id))
      .returning();
    return row ?? null;
  }

  async transitionAction(
    id: string,
    from: ManagementReviewAction['status'],
    to: ManagementReviewAction['status'],
    extra: Partial<Pick<ManagementReviewAction, 'completedAt' | 'outcomeNote'>>,
    tx?: DbExecutor,
  ): Promise<ManagementReviewAction | null> {
    const [row] = await (tx ?? this.db)
      .update(managementReviewActions)
      .set({ status: to, ...extra, updatedAt: new Date() })
      .where(and(eq(managementReviewActions.id, id), eq(managementReviewActions.status, from)))
      .returning();
    return row ?? null;
  }

  async carriedForward(
    excludeReviewId: string | null,
    limit: number,
  ): Promise<CarriedForwardAction[]> {
    return (
      this.db
        .select({
          id: managementReviewActions.id,
          reviewReference: managementReviews.reference,
          category: managementReviewActions.category,
          description: managementReviewActions.description,
          ownerId: managementReviewActions.ownerId,
          status: managementReviewActions.status,
          dueOn: managementReviewActions.dueOn,
          // Null when it has no due date: there is nothing to be overdue by, and 0 would read as "due
          // today" for an action nobody dated.
          daysOverdue: sql<number | null>`
          CASE WHEN ${managementReviewActions.dueOn} IS NULL THEN NULL
               ELSE (current_date - ${managementReviewActions.dueOn})::int END
        `,
        })
        .from(managementReviewActions)
        .innerJoin(
          managementReviews,
          eq(managementReviews.id, managementReviewActions.managementReviewId),
        )
        .where(
          and(
            notInArray(managementReviewActions.status, [...SETTLED_ACTIONS]),
            // A review does not review its own outputs — see the port's docblock.
            excludeReviewId
              ? ne(managementReviewActions.managementReviewId, excludeReviewId)
              : undefined,
          ),
        )
        // Most overdue first, undated last. `id` last for a total order.
        .orderBy(
          sql`${managementReviewActions.dueOn} ASC NULLS LAST`,
          asc(managementReviewActions.id),
        )
        .limit(limit)
    );
  }
}

function reviewColumns() {
  return {
    id: managementReviews.id,
    reference: managementReviews.reference,
    title: managementReviews.title,
    period: managementReviews.period,
    status: managementReviews.status,
    chairId: managementReviews.chairId,
    scheduledFor: managementReviews.scheduledFor,
    heldOn: managementReviews.heldOn,
    inputs: managementReviews.inputs,
    conclusion: managementReviews.conclusion,
    minutesDocumentId: managementReviews.minutesDocumentId,
    closedAt: managementReviews.closedAt,
    cancelReason: managementReviews.cancelReason,
    createdAt: managementReviews.createdAt,
    updatedAt: managementReviews.updatedAt,
  };
}

function actionColumns() {
  return {
    id: managementReviewActions.id,
    managementReviewId: managementReviewActions.managementReviewId,
    category: managementReviewActions.category,
    description: managementReviewActions.description,
    ownerId: managementReviewActions.ownerId,
    dueOn: managementReviewActions.dueOn,
    status: managementReviewActions.status,
    completedAt: managementReviewActions.completedAt,
    outcomeNote: managementReviewActions.outcomeNote,
    createdAt: managementReviewActions.createdAt,
    updatedAt: managementReviewActions.updatedAt,
  };
}

/** Whether a review has finished. Shared with the service's guards, as elsewhere. */
export const isSettledReview = (status: ManagementReview['status']): boolean =>
  (SETTLED_REVIEWS as readonly string[]).includes(status);

/** Whether an action has finished. */
export const isSettledAction = (status: ManagementReviewAction['status']): boolean =>
  (SETTLED_ACTIONS as readonly string[]).includes(status);
