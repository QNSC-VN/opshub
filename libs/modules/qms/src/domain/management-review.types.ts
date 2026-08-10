import type { managementReviewActions, managementReviews } from '../../../../../db/schema';

export type ManagementReview = typeof managementReviews.$inferSelect;
export type ManagementReviewAction = typeof managementReviewActions.$inferSelect;
export type ManagementReviewStatus = ManagementReview['status'];
export type ReviewActionCategory = ManagementReviewAction['category'];
export type ReviewActionStatus = ManagementReviewAction['status'];

export interface ScheduleReviewInput {
  reference: string;
  title: string;
  /** The period under review — "H1 2026". Free text; §9.3.1 leaves the interval to the organisation. */
  period: string;
  chairId: string;
  scheduledFor?: string | null;
}

/**
 * What may be corrected before the review is held.
 *
 * `status`, `inputs`, `heldOn`, the minutes and the conclusion are all absent. The first four belong
 * to the lifecycle methods; `inputs` is COMPOSED by the service and accepted from nobody, for the same
 * reason no API accepts a risk score.
 */
export type UpdateReviewInput = Partial<{
  title: string;
  period: string;
  chairId: string;
  scheduledFor: string | null;
}>;

export interface ReviewFilters {
  status?: ManagementReviewStatus;
  chairId?: string;
  /** Everything not closed or cancelled. */
  openOnly?: boolean;
  scheduledOnOrBefore?: string;
  search?: string;
}

/** A review row with its action counts, resolved in one query. */
export interface ManagementReviewRow extends ManagementReview {
  actionCount: number;
  openActionCount: number;
}

export interface RaiseActionInput {
  /** One of §9.3.3's three outputs. The clause is a closed list, so there is no `other`. */
  category: ReviewActionCategory;
  description: string;
  ownerId: string;
  dueOn?: string | null;
}

export type UpdateActionInput = Partial<{
  category: ReviewActionCategory;
  description: string;
  ownerId: string;
  dueOn: string | null;
}>;

export interface ActionFilters {
  status?: ReviewActionStatus;
  category?: ReviewActionCategory;
  ownerId?: string;
  managementReviewId?: string;
  /** Everything not completed or cancelled — the follow-up queue. */
  openOnly?: boolean;
  dueOnOrBefore?: string;
}

/** An action with the review it came out of, so a follow-up list needs no second round trip. */
export interface ReviewActionRow extends ManagementReviewAction {
  reviewReference: string;
  reviewPeriod: string;
}

/**
 * An action from an EARLIER review that is still outstanding — ISO 9001 §9.3.2(a).
 *
 * Carried into the next review's frozen inputs, which is how "the status of actions from previous
 * management reviews" is satisfied by construction rather than by somebody remembering to look.
 */
export interface CarriedForwardAction {
  id: string;
  reviewReference: string;
  category: ReviewActionCategory;
  description: string;
  ownerId: string;
  status: ReviewActionStatus;
  dueOn: string | null;
  /** Days past its due date, or null when it has none. */
  daysOverdue: number | null;
}

/**
 * The §9.3.2 inputs, assembled from the registers that own them.
 *
 * COUNTS AND REFERENCES ONLY, deliberately. §9.3.2 asks for "information on performance and
 * effectiveness, including trends" — which is an aggregate, not a data export. Holding
 * `management_review.read` therefore reveals HOW MUCH is outstanding across the ISMS and QMS
 * registers and which items by reference, but no owner, no supplier commercial detail and no
 * classification. A reader who needs the rows has the register's own permission and the register's own
 * screen; the narrowing is what stops this becoming a way around them.
 */
export interface ReviewAgenda {
  /** (a) the status of actions from previous management reviews. */
  previousActions: CarriedForwardAction[];
  /** (c)(4) nonconformities and corrective actions. */
  nonconformities: {
    containmentOverdue: number;
    overdueReferences: string[];
    recurringProcessAreas: string[];
  };
  /** (c)(6) audit results. */
  audits: {
    findingsNotLinkedToAnAudit: number;
    unlinkedReferences: string[];
  };
  /** (c)(7) the performance of external providers. */
  externalProviders: {
    reviewGaps: number;
    gapReferences: string[];
    criticalWithoutRisk: number;
    unassessedSpendLines: number;
  };
  /** (e) the effectiveness of actions taken to address risks. */
  risks: {
    untreated: number;
    untreatedReferences: string[];
  };
  /** When this bundle was assembled. On a held review, the moment it was frozen. */
  assembledAt: string;
}
