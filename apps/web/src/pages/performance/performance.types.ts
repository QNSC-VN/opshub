import type { components } from '@/shared/api/generated/api';

/**
 * The performance vocabulary, from the generated spec.
 *
 * Nothing re-typed by hand. Every screen in this migration that hand-wrote a response type drifted
 * from the API eventually, and the drift only ever showed up as a blank cell.
 */

export type Cycle = components['schemas']['CycleResponseDto'];
export type Review = components['schemas']['ReviewResponseDto'];
export type Goal = components['schemas']['GoalResponseDto'];
export type RatingLevel = components['schemas']['RatingLevelResponseDto'];
export type CycleProgress = components['schemas']['CycleProgressResponseDto'];
export type CoverageGap = components['schemas']['CoverageGapResponseDto'];

/**
 * A cycle's states. `all` is the API's own word for "no filter", not an empty string — unlike every
 * other list in this product, which is worth stating because it is the kind of difference a shared
 * filter component silently gets wrong.
 */
export const CYCLE_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
] as const;

/**
 * A review's states, in lifecycle order.
 *
 * `self_assessment` → `manager_review` → `pending_approval` → `shared` → `acknowledged`, with
 * `cancelled` off to one side. The order matters here because the filter reads as a pipeline: a
 * manager asking "what is waiting on me" is asking for one of the middle two.
 */
export const REVIEW_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'self_assessment', label: 'Self-assessment' },
  { value: 'manager_review', label: 'Manager review' },
  { value: 'pending_approval', label: 'Approval' },
  { value: 'shared', label: 'Shared' },
  { value: 'acknowledged', label: 'Acknowledged' },
] as const;

/**
 * What a review's goal weights must total before it can be sent for approval.
 *
 * The API enforces it (with a cent of tolerance, because the column is `numeric(5,2)`); the UI shows
 * the running total so nobody discovers a set adding to 90 at the moment they try to submit.
 */
export const REQUIRED_WEIGHT_TOTAL = 100;
