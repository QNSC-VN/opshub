import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import type { components } from '@/shared/api/types';

export type LicenseAssignment = components['schemas']['LicenseAssignmentResponseDto'];

/**
 * The seats on one licence.
 *
 * `includeRevoked` OFF by default: the question a seat list answers is "who is using this right now", and the
 * revoked rows are the audit trail behind it. Both matter, which is why the panel toggles rather than picks.
 *
 * Keyed under `['licenses', …]` with the register and the utilisation report, because a seat is what makes
 * those numbers move: assigning one changes `usedSeats`, and a screen that refreshed the seat list without the
 * report would show a full licence beside a report claiming spare capacity.
 */
export function useSeats(licenseId: string | null, includeRevoked: boolean) {
  return useQuery<LicenseAssignment[]>({
    queryKey: ['licenses', 'seats', licenseId, includeRevoked],
    enabled: !!licenseId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/licenses/{id}/assignments', {
        params: {
          path: { id: licenseId! },
          query: { includeRevoked: includeRevoked || undefined },
        },
      });
      if (error || !data) throw new Error('Failed to load the seats');
      return data;
    },
  });
}

/**
 * Revoking a seat.
 *
 * A SOFT REVOKE, and the panel says so: the row stays with a `revokedAt`, because "who had a Photoshop seat in
 * March" is the question a licence true-up asks, and a deleted row cannot answer it. Freeing the seat and
 * erasing the history are different things.
 */
export function useRevokeSeat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await api.DELETE('/v1/licenses/assignments/{assignmentId}', {
        params: { path: { assignmentId } },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to revoke the seat.'));
    },
    onSuccess: () => {
      toast.success('Seat revoked');
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
