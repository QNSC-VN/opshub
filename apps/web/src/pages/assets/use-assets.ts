import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import type { Asset, AssetAssignment } from './asset.types';

/**
 * Every read the asset register makes.
 *
 * Keys start `['assets', …]`. Assigning changes the row's status AND appends to its history, so one
 * invalidation refreshes both rather than leaving a drawer that says "in stock" beside a history whose latest
 * row has no return date.
 */

export function useAssets(params: {
  status: string;
  type: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const { status, type, search, limit, offset } = params;
  return useQuery({
    queryKey: ['assets', 'list', status, type, search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/assets', {
        params: {
          query: {
            status: (status || undefined) as never,
            type: (type || undefined) as never,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load assets');
      return data;
    },
  });
}

/**
 * Who has held this asset, newest first.
 *
 * WHY THE HISTORY MATTERS MORE THAN THE CURRENT HOLDER. `assignedTo` answers "where is it now"; the history
 * answers "who had it when the data on it leaked", which is the question an incident asks. A row with no
 * `returnedAt` is the open assignment, so the list is also how a mismatch between the row's status and its
 * assignments becomes visible.
 */
export function useAssetAssignments(assetId: string | null) {
  return useQuery<AssetAssignment[]>({
    queryKey: ['assets', 'assignments', assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/assets/{id}/assignments', {
        params: { path: { id: assetId! } },
      });
      if (error || !data) throw new Error('Failed to load the assignment history');
      return data;
    },
  });
}

/**
 * The two transitions that take no input: returning an asset, and retiring one.
 *
 * BOTH ARE CONFIRMATIONS RATHER THAN FORMS, because neither has anything to collect — the return date is now
 * and retirement carries no reason field. What each dialog does carry is the consequence, since that is the
 * part somebody needs before clicking: unassigning closes the open custody row, and retiring takes the asset
 * out of the assignable pool for good.
 */
export function useAssetTransition(onDone: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ asset, action }: { asset: Asset; action: 'unassign' | 'retire' }) => {
      const params = { params: { path: { id: asset.id } } };
      const { error } =
        action === 'unassign'
          ? await api.POST('/v1/assets/{id}/unassign', params)
          : await api.POST('/v1/assets/{id}/retire', params);
      if (error)
        throw new Error(
          apiErrorMessage(
            error,
            action === 'unassign' ? 'Failed to return the asset.' : 'Failed to retire the asset.',
          ),
        );
      return action;
    },
    onSuccess: (action) => {
      toast.success(action === 'unassign' ? 'Asset returned to stock' : 'Asset retired');
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
