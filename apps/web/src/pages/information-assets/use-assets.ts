import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type {
  AssetDevice,
  ClassificationChange,
  ClassificationLevel,
  ClassificationSummary,
  DeviceHolding,
} from './asset.types';

/**
 * Every read the information-asset register makes.
 *
 * Keys start `['information-assets', …]`, so one invalidation refreshes the list, the classification
 * summary and an open asset's history together — reclassifying writes a history row and moves a count in
 * the summary, and those are three views of one write.
 */

export function useInformationAssets(params: {
  classification: string;
  type: string;
  personalDataOnly: boolean;
  /**
   * Whether RETIRED assets are in the answer.
   *
   * Off by default, matching the API: the register means the CURRENT inventory. It has to be reachable
   * all the same — retiring an asset otherwise looks like a delete, because the row simply leaves the
   * list, and the retired rows are what a risk assessment from last year still points at.
   */
  includeRetired: boolean;
  search: string;
  limit: number;
  offset: number;
}) {
  const { classification, type, personalDataOnly, includeRetired, search, limit, offset } = params;
  return useQuery({
    queryKey: [
      'information-assets',
      'list',
      classification,
      type,
      personalDataOnly,
      includeRetired,
      search,
      limit,
      offset,
    ],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/information-assets', {
        params: {
          query: {
            classification: (classification || undefined) as never,
            type: (type || undefined) as never,
            personalDataOnly: personalDataOnly || undefined,
            includeRetired: includeRetired || undefined,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the information-asset register');
      return data;
    },
  });
}

/**
 * The classification levels, as reference data.
 *
 * Each carries its HANDLING RULES and whether encryption is required. The UI shows those rather than
 * restating them: a handling rule copied into a component is a rule that stops matching the policy the
 * moment somebody edits the table.
 */
export function useClassificationLevels() {
  return useQuery<ClassificationLevel[]>({
    queryKey: ['information-assets', 'classification-levels'],
    // Reference data; it changes when policy changes, not per mount.
    staleTime: STALE.REFERENCE,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/information-assets/classification-levels');
      if (error || !data) throw new Error('Failed to load classification levels');
      return data;
    },
  });
}

/** How many assets sit at each level, and how many of those hold personal data or live on devices. */
export function useClassificationSummary() {
  return useQuery<ClassificationSummary[]>({
    queryKey: ['information-assets', 'classification-summary'],
    queryFn: async () => {
      const { data, error } = await api.GET(
        '/v1/information-assets/reports/classification-summary',
      );
      if (error || !data) throw new Error('Failed to load the classification summary');
      return data;
    },
  });
}

/**
 * Every classification change an asset has been through.
 *
 * The audit question is not "what is this classified as" but "when did it become that, and who said so".
 * The API appends a row per change with the reason, so the history is the answer and nothing here has to
 * reconstruct it.
 */
export function useClassificationHistory(assetId: string | null) {
  return useQuery<ClassificationChange[]>({
    queryKey: ['information-assets', 'history', assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/information-assets/{id}/classification-history', {
        params: { path: { id: assetId! } },
      });
      if (error || !data) throw new Error('Failed to load the classification history');
      return data;
    },
  });
}

/**
 * The devices this information asset is held on.
 *
 * This link is what turns "we classified the data" into "we know where it is" — a restricted dataset on
 * an unencrypted laptop is the finding, and it is invisible from either register alone.
 */
export function useAssetDevices(assetId: string | null) {
  return useQuery<AssetDevice[]>({
    queryKey: ['information-assets', 'devices', assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/information-assets/{id}/devices', {
        params: { path: { id: assetId! } },
      });
      if (error || !data) throw new Error('Failed to load the devices holding this asset');
      return data;
    },
  });
}

/**
 * What one DEVICE holds, worst classification first.
 *
 * THE SAME LINK, READ BACKWARDS. `useAssetDevices` answers "where does this data live"; this answers
 * "what was on that machine" — the question asked the moment a laptop is reported lost, and the one that
 * decides whether the loss is an incident. Retired assets are included, because a device disposed of last
 * year still held them.
 *
 * AN EMPTY LIST IS AN ANSWER, not a 404: the API deliberately does not validate the id against the
 * hardware register, so "nothing registered was on it" stays distinguishable from "that is not a device"
 * for the caller who most needs the difference.
 *
 * Keyed under `['information-assets', …]` like every other read here, so linking or unlinking a device
 * refreshes this too — it is a third view of the same table.
 */
export function useDeviceHoldings(deviceAssetId: string) {
  return useQuery<DeviceHolding[]>({
    queryKey: ['information-assets', 'device-holdings', deviceAssetId],
    enabled: !!deviceAssetId,
    queryFn: async () => {
      const { data, error } = await api.GET(
        '/v1/information-assets/reports/device-holdings/{deviceAssetId}',
        { params: { path: { deviceAssetId } } },
      );
      if (error || !data) throw new Error('Failed to load what this device holds');
      return data;
    },
  });
}
