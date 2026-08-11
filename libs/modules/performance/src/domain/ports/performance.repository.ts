import type { DbExecutor } from '@platform';
import type {
  CoverageGap,
  CreateCycleInput,
  CreateReviewInput,
  CycleProgress,
  PerformanceCycle,
  PerformanceGoal,
  PerformanceRating,
  PerformanceRatingLevel,
  PerformanceReview,
  PerformanceReviewStatus,
  ReviewFilters,
  SetGoalInput,
} from '../performance.types';

export const PERFORMANCE_REPOSITORY = Symbol('PERFORMANCE_REPOSITORY');

/**
 * EVERY TRANSITION IS A GUARDED UPDATE.
 *
 * Each state-changing method takes the state it expects to find and puts it in the `WHERE`, then
 * returns `null` when nothing matched. Two callers racing to submit the same review therefore both
 * run, and exactly one changes a row — a read-then-write would let both through and the second
 * would silently overwrite the first's decision. The service turns the `null` into a coded refusal.
 */
export interface IPerformanceRepository {
  // ── The rating scale (reference data) ──────────────────────────────────────
  listRatingScale(tx?: DbExecutor): Promise<PerformanceRatingLevel[]>;
  findRatingLevel(code: PerformanceRating, tx?: DbExecutor): Promise<PerformanceRatingLevel | null>;

  // ── Cycles ─────────────────────────────────────────────────────────────────
  createCycle(input: CreateCycleInput, tx?: DbExecutor): Promise<PerformanceCycle>;
  findCycleById(id: string, tx?: DbExecutor): Promise<PerformanceCycle | null>;
  findCycleByReference(reference: string): Promise<PerformanceCycle | null>;
  listCycles(
    status: PerformanceCycleStatusFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: PerformanceCycle[]; total: number }>;
  /** Guarded on `draft`. Returns null when the cycle was already open or closed. */
  openCycle(id: string, tx?: DbExecutor): Promise<PerformanceCycle | null>;
  /** Guarded on `open`. Returns null when the cycle was still a draft, or already closed. */
  closeCycle(id: string, tx?: DbExecutor): Promise<PerformanceCycle | null>;

  // ── Reviews ────────────────────────────────────────────────────────────────
  createReview(input: CreateReviewInput, tx?: DbExecutor): Promise<PerformanceReview>;
  findReviewById(id: string, tx?: DbExecutor): Promise<PerformanceReview | null>;
  findReviewForEmployee(cycleId: string, employeeId: string): Promise<PerformanceReview | null>;
  listReviews(
    filters: ReviewFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: PerformanceReview[]; total: number }>;
  /** Reassign the reviewer. Guarded on the states where the review is still being written. */
  reassignReviewer(
    id: string,
    reviewerId: string,
    tx?: DbExecutor,
  ): Promise<PerformanceReview | null>;
  /** Guarded on `self_assessment`; moves to `manager_review`. */
  submitSelfAssessment(
    id: string,
    text: string,
    tx?: DbExecutor,
  ): Promise<PerformanceReview | null>;
  /** Guarded on `manager_review`. Records the rating and stays there — rating is not submitting. */
  recordRating(
    id: string,
    input: {
      managerSummary: string;
      overallRating: PerformanceRating;
      developmentPlan: string | null;
    },
    tx?: DbExecutor,
  ): Promise<PerformanceReview | null>;
  /** Guarded on `manager_review`; moves to `pending_approval` and stores the engine backlink. */
  markPendingApproval(
    id: string,
    requestId: string,
    tx?: DbExecutor,
  ): Promise<PerformanceReview | null>;
  /** Guarded on `pending_approval`; moves to `shared` and records who signed it off. */
  markShared(id: string, approverId: string, tx?: DbExecutor): Promise<PerformanceReview | null>;
  /**
   * Guarded on `pending_approval`; back to `manager_review` for the reviewer to revise.
   *
   * The rating STAYS on the row: it is what was rejected, and clearing it would lose the thing the
   * reviewer has to change.
   */
  returnToReviewer(id: string, tx?: DbExecutor): Promise<PerformanceReview | null>;
  /** Guarded on `shared`; moves to `acknowledged` and stamps the date. */
  acknowledge(id: string, tx?: DbExecutor): Promise<PerformanceReview | null>;
  /** Guarded on every state before `shared` — a review the employee has read is not withdrawable. */
  cancelReview(id: string, tx?: DbExecutor): Promise<PerformanceReview | null>;

  // ── Goals ──────────────────────────────────────────────────────────────────
  /** Insert or update by (review, title), so re-sending the same goal is not a second row. */
  setGoal(input: SetGoalInput, tx?: DbExecutor): Promise<PerformanceGoal>;
  listGoals(reviewId: string, tx?: DbExecutor): Promise<PerformanceGoal[]>;
  removeGoal(id: string, tx?: DbExecutor): Promise<PerformanceGoal | null>;
  rateGoal(
    id: string,
    reviewId: string,
    input: { outcome: string | null; rating: PerformanceRating },
    tx?: DbExecutor,
  ): Promise<PerformanceGoal | null>;

  // ── Reporting ──────────────────────────────────────────────────────────────
  /**
   * Active employees in a cycle with no review, or one that has not reached `acknowledged`.
   *
   * An ANTI-JOIN, not a stored list: a cached "who is missing" is wrong the moment a review is
   * created, and the answer is one query.
   */
  coverageGaps(cycleId: string, limit: number): Promise<CoverageGap[]>;
  /** How many reviews sit in each state of a cycle. */
  cycleProgress(cycleId: string, tx?: DbExecutor): Promise<CycleProgress[]>;
  /** How many reviews are neither acknowledged nor cancelled — the close gate's input. */
  countUnfinishedReviews(cycleId: string, tx?: DbExecutor): Promise<number>;
}

/** `all` rather than an optional field, so a caller cannot omit it and get a surprise default. */
export type PerformanceCycleStatusFilter = 'all' | 'draft' | 'open' | 'closed';

/** Statuses that mean the review is finished, in either sense. */
export const SETTLED_REVIEW_STATUSES: readonly PerformanceReviewStatus[] = [
  'acknowledged',
  'cancelled',
];
