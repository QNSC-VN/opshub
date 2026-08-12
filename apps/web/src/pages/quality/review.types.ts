import type { components } from '@/shared/api/generated/api';

/**
 * The management-review vocabulary, from the generated spec.
 */

export type ManagementReview = components['schemas']['ManagementReviewRowResponseDto'];
export type ReviewAction = components['schemas']['ReviewActionRowResponseDto'];
export type ReviewAgenda = components['schemas']['ReviewAgendaResponseDto'];
export type CarriedForwardAction = components['schemas']['CarriedForwardActionResponseDto'];

/**
 * The review lifecycle: scheduled → held → closed, with `cancelled` reachable only from `scheduled`.
 *
 * `held` and `closed` are separate for the same reason an audit's `reported` and `closed` are: ISO 9001
 * §9.3.3 requires documented outputs, so a meeting that happened and whose minutes were never issued is not
 * a completed review. Once a review has been held its inputs are frozen and its actions raised, so there is
 * nothing left to cancel.
 */
export const REVIEW_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'held', label: 'Held' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/** Which action each review state allows, mirroring the service's transition map. */
export const REVIEW_NEXT_ACTIONS: Record<string, readonly ('hold' | 'close' | 'cancel')[]> = {
  scheduled: ['hold', 'cancel'],
  held: ['close'],
  closed: [],
  cancelled: [],
};

/**
 * What a review output can be about — §9.3.3's three categories, and no free text.
 *
 * An enum rather than a label somebody types: "improvement", "a change to the QMS" and "a resource need"
 * are the outputs the clause asks for, and a review whose actions are all uncategorised cannot show it
 * considered them.
 */
export const ACTION_CATEGORIES = ['improvement', 'qms_change', 'resource_need'] as const;

export const ACTION_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/** Which action each output state allows. `completed` and `cancelled` are terminal. */
export const ACTION_NEXT_ACTIONS: Record<string, readonly ('start' | 'complete' | 'cancel')[]> = {
  open: ['start', 'complete', 'cancel'],
  in_progress: ['complete', 'cancel'],
  completed: [],
  cancelled: [],
};
