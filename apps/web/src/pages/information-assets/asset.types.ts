import type { components } from '@/shared/api/generated/api';

/**
 * The information-asset vocabulary, from the generated spec.
 */

export type InformationAsset = components['schemas']['InformationAssetRowResponseDto'];
export type ClassificationLevel = components['schemas']['ClassificationLevelResponseDto'];
export type ClassificationChange = components['schemas']['ClassificationChangeResponseDto'];
export type ClassificationSummary = components['schemas']['ClassificationSummaryResponseDto'];
export type AssetDevice = components['schemas']['InformationAssetDeviceResponseDto'];

/** What kind of thing the asset is. A fixed vocabulary, so a `<select>` is right for it. */
export const ASSET_TYPES = [
  'system',
  'application',
  'database',
  'dataset',
  'repository',
  'document_set',
  'physical_record',
  'service',
  'other',
] as const;

/**
 * The four classification levels, lowest first.
 *
 * The LEVELS themselves are reference data the API serves (`/classification-levels`), carrying the
 * handling rules and whether encryption is required — so the UI reads those rather than restating them.
 * This list exists for the filter and for ordering a `<select>`, because a classification picker in
 * random order is a classification picker people get wrong.
 */
export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;

export const CLASSIFICATION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'confidential', label: 'Confidential' },
  { value: 'internal', label: 'Internal' },
  { value: 'public', label: 'Public' },
] as const;

/**
 * CIA ratings are 1–5, like the risk matrix.
 *
 * Confidentiality, integrity and availability are recorded separately because they drive different
 * decisions — a public dataset can still be availability-critical — and nothing here combines them into
 * a single number, which would throw away exactly that distinction.
 */
export const CIA_FACTORS = [1, 2, 3, 4, 5] as const;

/** Classification → badge tone. Higher classification, louder colour. */
export function classificationTone(classification: string): 'neutral' | 'blue' | 'amber' | 'red' {
  if (classification === 'restricted') return 'red';
  if (classification === 'confidential') return 'amber';
  if (classification === 'internal') return 'blue';
  return 'neutral';
}
