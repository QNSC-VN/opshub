import type { components } from '@/shared/api/generated/api';

/**
 * The controls / Statement of Applicability vocabulary, from the generated spec.
 */

export type Control = components['schemas']['ControlResponseDto'];
export type SoaRow = components['schemas']['SoaRowResponseDto'];
export type SoaCoverage = components['schemas']['SoaCoverageResponseDto'];
export type UntreatedRisk = components['schemas']['UntreatedRiskResponseDto'];
export type LinkedRisk = components['schemas']['LinkedRiskResponseDto'];

/** Annex A's four themes. A fixed vocabulary, so a `<select>` is the right control for it. */
export const CONTROL_THEMES = ['organizational', 'people', 'physical', 'technological'] as const;

/** Where a control came from: the standard, or this organisation. */
export const CONTROL_SOURCES = ['annex_a', 'custom'] as const;

/**
 * An SoA entry's implementation status.
 *
 * `not_applicable` is a STATUS, not the absence of one — excluding a control is a decision that needs a
 * justification, which is the whole point of a Statement of Applicability. An entry that has never been
 * decided has no row at all, and the coverage report counts those separately as `undecided`.
 */
export const SOA_STATUSES = [
  'not_applicable',
  'not_implemented',
  'partially_implemented',
  'implemented',
] as const;

export const SOA_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'partially_implemented', label: 'Partial' },
  { value: 'not_implemented', label: 'Not implemented' },
  { value: 'not_applicable', label: 'Excluded' },
] as const;
