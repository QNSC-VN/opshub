import type { components } from '@/shared/api/types';

/**
 * The people screen's types and constants.
 *
 * Split from the component module because eslint's `react-refresh/only-export-components` is right:
 * a file that exports both a component and a constant loses Fast Refresh for the component. Same
 * lesson the workforce conversion learned one screen earlier.
 */

export type EmployeeResponse = components['schemas']['EmployeeResponseDto'];
export type EquipmentType = NonNullable<
  components['schemas']['SubmitOnboardingDto']['equipmentType']
>;
export type PreferredOs = NonNullable<components['schemas']['SubmitOnboardingDto']['preferredOs']>;

/** The statuses the API accepts. Their COLOURS come from the shared `LIFECYCLE_TONE`. */
export const EMPLOYEE_STATUSES = ['active', 'on_leave', 'offboarded'] as const;

export const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'offboarded', label: 'Offboarded' },
];
