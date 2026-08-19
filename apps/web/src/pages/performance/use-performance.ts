import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type { Cycle, CycleProgress, Goal, RatingLevel } from './performance.types';

/**
 * Every read the performance screens make.
 *
 * All keys start `['performance', …]`, so one `invalidateQueries({ queryKey: ['performance'] })` after
 * any mutation refreshes whichever tabs are mounted — rating a review has to move the cycle's progress
 * counts and the coverage report, and those live on a different tab.
 */

export function useCycles(status: string, limit: number, offset: number) {
  return useQuery({
    queryKey: ['performance', 'cycles', status, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/cycles', {
        // `all` is a real value here, not the absence of one — see CYCLE_STATUS_FILTERS.
        params: { query: { status: status as never, limit, offset } },
      });
      if (error || !data) throw new Error('Failed to load review cycles');
      return data;
    },
  });
}

export function useReviews(params: {
  cycleId: string;
  employeeId: string;
  reviewerId: string;
  status: string;
  limit: number;
  offset: number;
}) {
  const { cycleId, employeeId, reviewerId, status, limit, offset } = params;
  return useQuery({
    queryKey: ['performance', 'reviews', cycleId, employeeId, reviewerId, status, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/reviews', {
        params: {
          query: {
            cycleId: cycleId || undefined,
            employeeId: employeeId || undefined,
            reviewerId: reviewerId || undefined,
            status: (status || undefined) as never,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load reviews');
      return data;
    },
  });
}

/** A cycle's review counts by status — the shape the progress bar is built from. */
export function useCycleProgress(cycleId: string | null) {
  return useQuery<CycleProgress[]>({
    queryKey: ['performance', 'cycle-progress', cycleId],
    enabled: !!cycleId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/cycles/{id}/progress', {
        params: { path: { id: cycleId! } },
      });
      if (error || !data) throw new Error('Failed to load cycle progress');
      return data;
    },
  });
}

/**
 * Who has NO review in this cycle, or one that never finished.
 *
 * The report a cycle exists for: "did everybody get reviewed" is not answerable from the review list,
 * because the people missing from it are the answer.
 */
/**
 * Who has not been reviewed, one page at a time.
 *
 * PAGED BECAUSE THE REPORT USED TO LIE. The endpoint capped at 500 rows and returned a bare array, so
 * past five hundred active employees the panel showed a subset and the section heading counted the
 * subset — a coverage report that gets shorter as the organisation grows.
 *
 * `offset` is part of the query key, so paging is a normal fetch with its own cache entry rather than
 * state the component has to reconcile.
 */
export function useCycleCoverage(cycleId: string | null, offset = 0) {
  return useQuery({
    queryKey: ['performance', 'cycle-coverage', cycleId, offset],
    enabled: !!cycleId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/cycles/{id}/coverage', {
        params: { path: { id: cycleId! }, query: { offset, limit: COVERAGE_PAGE_SIZE } },
      });
      if (error || !data) throw new Error('Failed to load coverage');
      // The envelope, unwrapped by the caller — same shape as `useCycles` above, because a second
      // convention for reading a paged response is how `data.data` becomes `data.rows` in one file.
      return data;
    },
  });
}

/**
 * How many gaps a page of the coverage report holds.
 *
 * Small on purpose: this renders inside a slide-over section, not a full-width table, and a chaser
 * works through it a screenful at a time. `pageInfo.total` still reports everybody outstanding, so the
 * number here changes how much scrolling there is and not what the report claims.
 */
export const COVERAGE_PAGE_SIZE = 25;

export function useReviewGoals(reviewId: string | null) {
  return useQuery<Goal[]>({
    queryKey: ['performance', 'goals', reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/reviews/{id}/goals', {
        params: { path: { id: reviewId! } },
      });
      if (error || !data) throw new Error('Failed to load goals');
      return data;
    },
  });
}

/**
 * The rating scale, from the API rather than from a constant here.
 *
 * It is a reference TABLE with a rank and a `requiresDevelopmentPlan` flag, and that flag is a rule:
 * a rating carrying it cannot be saved without a plan. Hard-coding the levels in the SPA would put the
 * rule in two places and let a scale change apply to the API and not to the form that feeds it.
 */
export function useRatingScale() {
  return useQuery<RatingLevel[]>({
    queryKey: ['performance', 'rating-scale'],
    // The scale changes about never; refetching it per mount is pure noise.
    staleTime: STALE.REFERENCE,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/rating-scale');
      if (error || !data) throw new Error('Failed to load the rating scale');
      return data;
    },
  });
}

/** The caller's OWN reviews — self-scoped, so no permission code is involved. */
export function useMyReviews() {
  return useQuery({
    queryKey: ['performance', 'me', 'reviews'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/me');
      if (error || !data) throw new Error('Failed to load your reviews');
      return data;
    },
  });
}

/** The reviews assigned TO the caller — the manager's queue, also self-scoped. */
export function useReviewsToWrite() {
  return useQuery({
    queryKey: ['performance', 'me', 'to-review'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/me/to-review');
      if (error || !data) throw new Error('Failed to load the reviews assigned to you');
      return data;
    },
  });
}

/**
 * The cycles a page of reviews actually refers to, by id.
 *
 * NOT "the first hundred cycles". That was the first version, and it was wrong for the reason every
 * `limit: 100` lookup in this codebase has been wrong: the database holds 306 cycles (each API e2e run
 * adds some), the fetch took the oldest hundred, and every review outside them rendered its raw
 * `cycleId` — measured against the running API. A label lookup that silently stops labelling is worse
 * than no label, because the screen still looks like it is working.
 *
 * One request per DISTINCT cycle on the page instead: bounded by the page size, and in practice one or
 * two, because a page of reviews is usually a page of one cycle. React Query dedupes and caches them, so
 * paging back and forth costs nothing.
 */
export function useCycleLabels(cycleIds: string[]) {
  const unique = [...new Set(cycleIds)];
  const queries = useQueries({
    queries: unique.map((id) => ({
      queryKey: ['performance', 'cycle', id],
      // A cycle's reference and dates do not change once it exists.
      staleTime: STALE.RECORD,
      queryFn: async () => {
        const { data, error } = await api.GET('/v1/performance/cycles/{id}', {
          params: { path: { id } },
        });
        if (error || !data) throw new Error('Failed to load the review cycle');
        return data;
      },
    })),
  });

  const byId = new Map<string, Cycle>();
  queries.forEach((query) => {
    if (query.data) byId.set(query.data.id, query.data);
  });
  return byId;
}

/**
 * The OPEN cycles, for a filter that offers a choice between them.
 *
 * Deliberately a different query from the labels above: this one is a short list somebody picks from,
 * that one is "whatever these rows point at". Conflating them is what produced a filter built from a
 * truncated page.
 */
export function useOpenCycles() {
  return useQuery({
    queryKey: ['performance', 'open-cycles'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/performance/cycles', {
        params: { query: { status: 'open' as never, limit: 25, offset: 0 } },
      });
      if (error || !data) throw new Error('Failed to load open cycles');
      return data.data ?? [];
    },
  });
}
