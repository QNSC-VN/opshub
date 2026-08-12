import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { IncidentEvent, OverdueBreach } from './incident.types';

/**
 * Every read the incident screen makes.
 *
 * Keys start `['incidents', …]`, so one invalidation refreshes the list, the open timeline and the
 * breach report together — containing an incident writes a timeline entry and can clear it off the
 * overdue report, and those are three views of one write.
 */

export function useIncidents(params: {
  status: string;
  severity: string;
  openOnly: boolean;
  breachesOnly: boolean;
  assignedTo: string;
  limit: number;
  offset: number;
}) {
  const { status, severity, openOnly, breachesOnly, assignedTo, limit, offset } = params;
  return useQuery({
    queryKey: [
      'incidents',
      'list',
      status,
      severity,
      openOnly,
      breachesOnly,
      assignedTo,
      limit,
      offset,
    ],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/incidents', {
        params: {
          query: {
            status: (status || undefined) as never,
            severity: (severity || undefined) as never,
            // `false` is a real value the API now parses correctly (`queryBoolean`), but sending
            // `undefined` for "no filter" keeps the query string honest about what was asked.
            openOnly: openOnly || undefined,
            breachesOnly: breachesOnly || undefined,
            assignedTo: assignedTo || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load incidents');
      return data;
    },
  });
}

/**
 * An incident's timeline — APPEND-ONLY, and written by the transitions themselves.
 *
 * Every status change appends a `status_change` entry inside the same transaction as the move, so a
 * timeline cannot be missing the step the status column claims happened. Notes and evidence are the
 * entries a person adds.
 */
export function useTimeline(incidentId: string | null) {
  return useQuery<IncidentEvent[]>({
    queryKey: ['incidents', 'timeline', incidentId],
    enabled: !!incidentId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/incidents/{id}/timeline', {
        params: { path: { id: incidentId! } },
      });
      if (error || !data) throw new Error('Failed to load the timeline');
      return data;
    },
  });
}

/**
 * Breaches past their 72-hour notification deadline.
 *
 * Computed by the API from `notificationDueAt`, with the hours overdue included — the number a DPO is
 * asked for. The SPA does not derive it: a deadline calculated in two places is a deadline two systems
 * can disagree about, and this one has a regulator on the other end of it.
 */
export function useOverdueBreaches() {
  return useQuery<OverdueBreach[]>({
    queryKey: ['incidents', 'overdue-breaches'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/incidents/breaches/overdue');
      if (error || !data) throw new Error('Failed to load overdue breaches');
      return data;
    },
  });
}

/**
 * Incidents with no risk behind them.
 *
 * The ISMS question this answers: an incident that happened and was never traced back to a risk means
 * the register does not know about a thing that already went wrong. Joined by the API.
 */
export function useUnlinkedIncidents() {
  return useQuery({
    queryKey: ['incidents', 'unlinked-to-risk'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/incidents/unlinked-to-risk');
      if (error || !data) throw new Error('Failed to load incidents with no linked risk');
      return data;
    },
  });
}
