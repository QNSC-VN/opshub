import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { LinkedRisk, SoaCoverage, UntreatedRisk } from './control.types';

/**
 * Every read the controls and SoA screens make.
 *
 * Keys start `['controls', …]`. Deciding an SoA entry moves the coverage counts, so the table and the
 * tiles above it are never independent — one invalidation refreshes both.
 */

export function useControls(params: {
  theme: string;
  source: string;
  includeRetired: boolean;
  limit: number;
  offset: number;
}) {
  const { theme, source, includeRetired, limit, offset } = params;
  return useQuery({
    queryKey: ['controls', 'catalogue', theme, source, includeRetired, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/controls', {
        params: {
          query: {
            theme: (theme || undefined) as never,
            source: (source || undefined) as never,
            includeRetired,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the control catalogue');
      return data;
    },
  });
}

/** The Statement of Applicability: every control that has been DECIDED, and what was decided. */
export function useSoa(params: { status: string; theme: string; limit: number; offset: number }) {
  const { status, theme, limit, offset } = params;
  return useQuery({
    queryKey: ['controls', 'soa', status, theme, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/controls/soa', {
        params: {
          query: {
            status: (status || undefined) as never,
            theme: (theme || undefined) as never,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the Statement of Applicability');
      return data;
    },
  });
}

/**
 * The coverage counts — the numbers an audit opens with.
 *
 * `undecided` is the interesting one: controls with no SoA entry at all. A Statement of Applicability
 * that omits a control has not excluded it, it has failed to consider it, and those are different
 * findings.
 */
export function useSoaCoverage() {
  return useQuery<SoaCoverage>({
    queryKey: ['controls', 'soa-coverage'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/controls/soa/coverage');
      if (error || !data) throw new Error('Failed to load SoA coverage');
      return data;
    },
  });
}

/**
 * Risks with no control behind them.
 *
 * The other half of the link the risk register maintains: a risk whose treatment decision was "mitigate"
 * and which no control implements is a plan without a mechanism. Computed by the API, because it is a
 * join across risks, links and SoA entries.
 */
export function useUntreatedRisks() {
  return useQuery<UntreatedRisk[]>({
    queryKey: ['controls', 'untreated-risks'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/controls/soa/untreated-risks');
      if (error || !data) throw new Error('Failed to load untreated risks');
      return data;
    },
  });
}

/** The risks a control is linked to — the justification for keeping it. */
export function useControlRisks(controlId: string | null) {
  return useQuery<LinkedRisk[]>({
    queryKey: ['controls', 'risks', controlId],
    enabled: !!controlId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/controls/{id}/risks', {
        params: { path: { id: controlId! } },
      });
      if (error || !data) throw new Error('Failed to load the linked risks');
      return data;
    },
  });
}
