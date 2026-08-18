import type { components } from '@/shared/api/generated/api';

/**
 * The supplier-register vocabulary, from the generated spec.
 */

export type Vendor = components['schemas']['VendorRowResponseDto'];
export type VendorAssessment = components['schemas']['VendorAssessmentResponseDto'];
export type CriticalityLevel = components['schemas']['VendorCriticalityLevelResponseDto'];
export type ReviewGap = components['schemas']['VendorReviewGapResponseDto'];
export type UnassessedSpend = components['schemas']['UnassessedSpendResponseDto'];
/**
 * A risk linked to a supplier — the RISK REGISTER'S OWN dto, in full.
 *
 * NOT `LinkedRiskResponseDto`, which is what this alias used to point at. That schema belongs to
 * `/v1/controls/{id}/risks` and carries three fields; `/v1/vendors/{id}/risks` returns `RiskResponseDto`,
 * because `VendorController.risks` maps through the risk register's own `toRiskDto` deliberately — its
 * docblock says a second mapper is how one of them silently stops emitting a field a screen reads.
 *
 * The narrower alias was assignable, so nothing complained; it just hid `status` and `inherentScore` from
 * every caller. Both are now on the panel, which is how the mistake surfaced.
 */
export type LinkedRisk = components['schemas']['RiskResponseDto'];

/**
 * The lifecycle: prospective → active, with suspend/reinstate and terminate.
 *
 * `activate` and `reinstate` both need `vendor.approve` rather than `vendor.manage` — letting a supplier
 * back in is a different decision from editing its record, and the API separates the two codes. The screen
 * mirrors that split rather than gating everything on one.
 */
export const VENDOR_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'prospective', label: 'Prospective' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
] as const;

export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;

/** What an assessment concluded. `pass_with_conditions` is a pass that owes something. */
export const ASSESSMENT_OUTCOMES = ['pass', 'pass_with_conditions', 'fail'] as const;

/** Criticality → badge tone, matching the incident severity scale so one reader learns one thing. */
export function criticalityTone(criticality: string): 'neutral' | 'blue' | 'amber' | 'red' {
  if (criticality === 'critical') return 'red';
  if (criticality === 'high') return 'amber';
  if (criticality === 'medium') return 'blue';
  return 'neutral';
}

/** Assessment outcome → tone. A conditional pass is not a pass, and does not look like one. */
export function outcomeTone(
  outcome: string | null | undefined,
): 'neutral' | 'green' | 'amber' | 'red' {
  if (outcome === 'pass') return 'green';
  if (outcome === 'pass_with_conditions') return 'amber';
  if (outcome === 'fail') return 'red';
  return 'neutral';
}
