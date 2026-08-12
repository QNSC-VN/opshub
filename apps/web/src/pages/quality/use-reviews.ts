import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { CarriedForwardAction, ReviewAgenda } from './review.types';

/**
 * Every read the management-review programme makes.
 *
 * Keys start `['quality', …]` with the rest of QMS, because the agenda IS the other registers: findings,
 * audits, suppliers, risks. One prefix means completing an action or closing a finding refreshes the agenda
 * that counts it.
 */

export function useReviews(params: {
  status: string;
  openOnly: boolean;
  search: string;
  limit: number;
  offset: number;
}) {
  const { status, openOnly, search, limit, offset } = params;
  return useQuery({
    queryKey: ['quality', 'reviews', status, openOnly, search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/management-reviews', {
        params: {
          query: {
            status: (status || undefined) as never,
            openOnly: openOnly || undefined,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the review programme');
      return data;
    },
  });
}

export function useReviewActions(params: {
  status: string;
  managementReviewId?: string;
  openOnly: boolean;
  limit: number;
  offset: number;
}) {
  const { status, managementReviewId, openOnly, limit, offset } = params;
  return useQuery({
    queryKey: [
      'quality',
      'review-actions',
      status,
      managementReviewId ?? '',
      openOnly,
      limit,
      offset,
    ],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/management-reviews/actions', {
        params: {
          query: {
            status: (status || undefined) as never,
            managementReviewId,
            openOnly: openOnly || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the review actions');
      return data;
    },
  });
}

/**
 * The agenda for a review that has not been held yet.
 *
 * ASSEMBLED, NOT STORED. §9.3.2 lists what a review must consider, and every item is something another
 * register already answers — so this composes them live and keeps no copy, because a second copy of "eleven
 * findings are overdue" disagrees with the register within a day.
 *
 * `id` is optional because the API answers both questions: `/agenda` is "what would a review consider right
 * now", which is what somebody scheduling one wants to see, and `/{id}/agenda` is the same for a specific
 * review — until it is held, at which point the numbers are FROZEN onto the row and read from `inputs`.
 */
export function useAgenda(reviewId: string | null) {
  return useQuery<ReviewAgenda>({
    queryKey: ['quality', 'agenda', reviewId ?? 'current'],
    queryFn: async () => {
      const { data, error } = reviewId
        ? await api.GET('/v1/management-reviews/{id}/agenda', {
            params: { path: { id: reviewId } },
          })
        : await api.GET('/v1/management-reviews/agenda');
      if (error || !data) throw new Error('Failed to assemble the agenda');
      return data;
    },
  });
}

/**
 * Actions from earlier reviews that are still open.
 *
 * §9.3.2(a) asks for the status of actions from PREVIOUS reviews, and this is that list — the one input a
 * review cannot assemble from a register, because it is about the review programme itself. An action carried
 * forward twice is the signal the clause exists to produce.
 */
export function useCarriedForward() {
  return useQuery<CarriedForwardAction[]>({
    queryKey: ['quality', 'carried-forward'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/management-reviews/actions/carried-forward');
      if (error || !data) throw new Error('Failed to load the carried-forward actions');
      return data;
    },
  });
}
