import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type {
  Capa,
  ContainmentOverdue,
  Nonconformance,
  RecurrenceSignal,
  Severity,
} from './quality.types';

/**
 * Every read the two quality registers make.
 *
 * Keys start `['quality', …]` FOR BOTH REGISTERS ON PURPOSE. Verifying a CAPA effective is what lets its
 * finding close, so it moves the CAPA row, the finding's `verifiedCapaCount`, and the containment and
 * recurrence reports at once. One prefix means one invalidation covers all of them, instead of a screen
 * that says a CAPA is verified next to a finding that still says it cannot close.
 */

export function useNonconformances(params: {
  status: string;
  severity: string;
  source: string;
  processArea: string;
  capaRequiredOnly: boolean;
  search: string;
  limit: number;
  offset: number;
}) {
  const { status, severity, source, processArea, capaRequiredOnly, search, limit, offset } = params;
  return useQuery({
    queryKey: [
      'quality',
      'nonconformances',
      status,
      severity,
      source,
      processArea,
      capaRequiredOnly,
      search,
      limit,
      offset,
    ],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/nonconformances', {
        params: {
          query: {
            status: (status || undefined) as never,
            severity: (severity || undefined) as never,
            source: (source || undefined) as never,
            processArea: processArea || undefined,
            capaRequiredOnly: capaRequiredOnly || undefined,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the non-conformance register');
      return data;
    },
  });
}

/**
 * The severity grades, as reference data.
 *
 * Each carries `requiresCapa` and `containmentDueDays` — the two facts that decide whether a finding can
 * ever close without a verified CAPA, and by when it must be contained. Read from the API because the
 * service reads them from the same table: re-grading a finding from minor to major then tightens its
 * closure requirement with no code change on either side, which is what makes re-grading mean something.
 */
export function useSeverities() {
  return useQuery<Severity[]>({
    queryKey: ['quality', 'severities'],
    staleTime: STALE.REFERENCE,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/nonconformances/severities');
      if (error || !data) throw new Error('Failed to load the severity grades');
      return data;
    },
  });
}

export function useNonconformanceCapas(nonconformanceId: string | null) {
  return useQuery<Capa[]>({
    queryKey: ['quality', 'nonconformance-capas', nonconformanceId],
    enabled: !!nonconformanceId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/nonconformances/{id}/capas', {
        params: { path: { id: nonconformanceId! } },
      });
      if (error || !data) throw new Error('Failed to load the CAPAs');
      return data;
    },
  });
}

export function useCapas(params: {
  status: string;
  openOnly: boolean;
  dueOnOrBefore: string;
  limit: number;
  offset: number;
}) {
  const { status, openOnly, dueOnOrBefore, limit, offset } = params;
  return useQuery({
    queryKey: ['quality', 'capas', status, openOnly, dueOnOrBefore, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/capas', {
        params: {
          query: {
            status: (status || undefined) as never,
            openOnly: openOnly || undefined,
            dueOnOrBefore: dueOnOrBefore || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the CAPA register');
      return data;
    },
  });
}

/** One finding, live. Shared key shape with `useFindingLabels`, so both read one cache entry. */
const findingQuery = (id: string) => ({
  queryKey: ['quality', 'nonconformance', id] as const,
  queryFn: async () => {
    const { data, error } = await api.GET('/v1/nonconformances/{id}', {
      params: { path: { id } },
    });
    if (error || !data) throw new Error('Failed to load the finding');
    return data as Nonconformance;
  },
});

/**
 * The finding a drawer is open on, refetched rather than remembered.
 *
 * WHY THIS EXISTS. The register handed the drawer the ROW OBJECT it was clicked from, and that snapshot never
 * updated — so after a CAPA was verified effective, the drawer still held `verifiedCapaCount: 0` and went on
 * saying the finding could not close, with no Close action, until somebody reloaded the page. Measured in the
 * browser: the register row updated and the drawer beside it did not. The drawer reads the row by id so that
 * one invalidation moves both.
 */
export function useNonconformance(id: string | null) {
  return useQuery({
    ...findingQuery(id ?? ''),
    enabled: !!id,
  });
}

/**
 * The findings behind a page of CAPAs, keyed by id.
 *
 * WHY BY ID AND NOT ONE BIG LIST. A CAPA row carries only `nonconformanceId`, and the queue is read across
 * findings — so without this the screen shows a raw UUID, which is what the cycles picker did before it was
 * fixed the same way. Fetching `limit=100` and hoping the finding is in it fails silently once the register
 * outgrows the page; one cached query per id on the page cannot.
 */
export function useFindingLabels(ids: string[]) {
  const unique = [...new Set(ids)];
  const results = useQueries({
    queries: unique.map((id) => ({ ...findingQuery(id), staleTime: STALE.REPORT })),
  });

  const byId = new Map<string, Nonconformance>();
  unique.forEach((id, index) => {
    const row = results[index]?.data;
    if (row) byId.set(id, row);
  });
  return byId;
}

/**
 * Findings past their containment deadline.
 *
 * The deadline is `detectedAt` plus the grade's `containmentDueDays`, so the API owns both the date and the
 * overdue count — a critical finding due in one day and an observation due in thirty are the same report
 * with different reference data, and computing it here would be computing it twice from a copy.
 */
export function useContainmentOverdue() {
  return useQuery<ContainmentOverdue[]>({
    queryKey: ['quality', 'containment-overdue'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/nonconformances/reports/containment-overdue');
      if (error || !data) throw new Error('Failed to load the containment report');
      return data;
    },
  });
}

/**
 * Process areas where a finding came back AFTER a CAPA there was verified effective.
 *
 * This is the report the module exists to produce. Every other number says work happened; this one asks
 * whether the work worked, and a recurrence is direct evidence that a root cause was never the root cause.
 * `earlierCapaVerifiedAt` before `latestDetectedAt` is the whole claim, which is why both dates show.
 */
export function useRecurrence() {
  return useQuery<RecurrenceSignal[]>({
    queryKey: ['quality', 'recurrence'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/nonconformances/reports/recurrence');
      if (error || !data) throw new Error('Failed to load the recurrence report');
      return data;
    },
  });
}
