import type { components } from '@/shared/api/generated/api';

/**
 * The risk-register vocabulary, from the generated spec.
 */

export type Risk = components['schemas']['RiskResponseDto'];
export type Treatment = components['schemas']['RiskTreatmentResponseDto'];
export type LinkedControl = components['schemas']['LinkedControlResponseDto'];

/**
 * The lifecycle, in order: identified → assessed → treated, with accept and close as exits.
 *
 * Every move is a guarded transition in the service AND a `WHERE status = <from>` in the repository, so
 * the UI offers the action for a state and lets the API decide — it never computes whether a move is
 * legal, because that would be a second copy of the state machine.
 */
export const RISK_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'identified', label: 'Identified' },
  { value: 'assessed', label: 'Assessed' },
  { value: 'treated', label: 'Treated' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
] as const;

/** What a treatment action can be. `done` is what lets a risk become `treated`. */
export const TREATMENT_STATUSES = ['planned', 'in_progress', 'done', 'cancelled'] as const;

/** The four decisions ISO 27005 recognises, and the API's enum. */
export const TREATMENT_DECISIONS = ['mitigate', 'accept', 'transfer', 'avoid'] as const;

/**
 * Likelihood and impact are 1–5, and the SCORE IS A GENERATED COLUMN.
 *
 * The API passes factors and reads scores; there is deliberately no arithmetic in the service to drift,
 * and none here either — the form sends the two factors and the row comes back with the product.
 */
export const MATRIX_FACTORS = [1, 2, 3, 4, 5] as const;

/**
 * Where sign-off starts being required.
 *
 * Mirrors `ACCEPTANCE_APPROVAL_THRESHOLD` in `risk.service.ts`: at or above 12 on the 5×5 matrix — the
 * "high" band — accepting a risk raises an approval request instead of writing the acceptance. The UI
 * uses it for ONE thing: telling the user which of those two is about to happen. The decision itself is
 * the API's, and the response says which path it took (`requestId` set or null).
 */
export const ACCEPTANCE_APPROVAL_THRESHOLD = 12;

/**
 * Score bands, for colour.
 *
 * A number on its own does not say whether somebody should be worried, and "12" meaning high is a policy
 * fact rather than arithmetic. Bands live here so the register, the drawer and the reports agree.
 */
export function scoreTone(score: number | null | undefined): 'neutral' | 'green' | 'amber' | 'red' {
  if (score == null) return 'neutral';
  if (score >= ACCEPTANCE_APPROVAL_THRESHOLD) return 'red';
  if (score >= 6) return 'amber';
  return 'green';
}
