import type { components } from '@/shared/api/types';

export type Contract = components['schemas']['ContractResponseDto'];

export const CONTRACT_TYPES = [
  'permanent',
  'fixed_term',
  'probation',
  'internship',
  'contractor',
] as const;

export const SALARY_PERIODS = ['hourly', 'monthly', 'annual'] as const;

/**
 * `compensation: null` means EITHER "no pay terms recorded" OR "not visible to you".
 *
 * The API returns the same shape for both on purpose — distinguishing them would tell a caller without
 * `contract.compensation.read` that a figure exists, which is most of what the permission protects. So
 * the UI must not claim "no pay recorded" either: it says the pay is not shown, and leaves which reason
 * unstated, exactly as the API does.
 */
export const COMPENSATION_HIDDEN = 'Not shown';
