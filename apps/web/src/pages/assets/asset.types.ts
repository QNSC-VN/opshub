import type { components } from '@/shared/api/generated/api';

/**
 * The asset vocabulary, from the generated spec.
 */

export type Asset = components['schemas']['AssetResponseDto'];
export type AssetAssignment = components['schemas']['AssetAssignmentResponseDto'];

export const ASSET_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'retired', label: 'Retired' },
  { value: 'lost', label: 'Lost' },
] as const;

/**
 * Which action each state allows, mirroring `AssetService`.
 *
 * THE TWO REFUSALS WORTH KNOWING. A `retired` or `lost` asset cannot be assigned — handing out hardware the
 * inventory has written off is how a device ends up on somebody's desk and off the register. And an
 * `assigned` asset cannot be retired: it has to come back first, because retiring it in place leaves the
 * holder responsible for something the inventory says no longer exists.
 *
 * `in_repair` can still be assigned: the machine exists, and lending it out is a decision somebody may
 * legitimately make.
 */
export const ASSET_NEXT_ACTIONS: Record<string, readonly ('assign' | 'unassign' | 'retire')[]> = {
  in_stock: ['assign', 'retire'],
  assigned: ['unassign'],
  in_repair: ['assign', 'retire'],
  retired: [],
  lost: [],
};
