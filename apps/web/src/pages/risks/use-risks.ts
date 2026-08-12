import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { LinkedControl, Treatment } from './risk.types';

/**
 * Every read the risk register makes.
 *
 * Keys start `['risks', …]`, so one `invalidateQueries({ queryKey: ['risks'] })` after a mutation
 * refreshes the list, the open drawer's treatments and its linked controls together. Marking the last
 * treatment done is what allows a risk to become `treated`, so those three views are never independent.
 */

export function useRisks(params: {
  status: string;
  ownerId: string;
  category: string;
  minInherentScore: string;
  limit: number;
  offset: number;
}) {
  const { status, ownerId, category, minInherentScore, limit, offset } = params;
  return useQuery({
    queryKey: ['risks', 'list', status, ownerId, category, minInherentScore, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/risks', {
        params: {
          query: {
            status: (status || undefined) as never,
            ownerId: ownerId || undefined,
            category: category || undefined,
            // Sent as a NUMBER: the API parses it, and an empty box is "no floor" rather than zero.
            minInherentScore: minInherentScore ? Number(minInherentScore) : undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the risk register');
      return data;
    },
  });
}

/** A risk's treatment actions — the plan that has to finish before it can be marked treated. */
export function useTreatments(riskId: string | null) {
  return useQuery<Treatment[]>({
    queryKey: ['risks', 'treatments', riskId],
    enabled: !!riskId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/risks/{id}/treatments', {
        params: { path: { id: riskId! } },
      });
      if (error || !data) throw new Error('Failed to load the treatment plan');
      return data;
    },
  });
}

/**
 * The controls mitigating a risk.
 *
 * The link is what makes the Statement of Applicability answerable in both directions: which controls
 * carry this risk, and which risks justify this control. A control with no risk behind it is either
 * inherited from the standard or unnecessary, and that is a question an auditor asks.
 */
export function useRiskControls(riskId: string | null) {
  return useQuery<LinkedControl[]>({
    queryKey: ['risks', 'controls', riskId],
    enabled: !!riskId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/risks/{id}/controls', {
        params: { path: { id: riskId! } },
      });
      if (error || !data) throw new Error('Failed to load the linked controls');
      return data;
    },
  });
}
