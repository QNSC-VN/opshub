import type { components } from '@/shared/api/types';

/**
 * The list returns OCCUPANCY, not the bare position: `filled` and `vacancies` alongside the record.
 *
 * That is the shape the screen wants — "2 of 3 filled" is the question a headcount table exists to
 * answer — and it comes from the generated schema rather than being assembled here.
 */
export type Position = components['schemas']['PositionOccupancyResponseDto'];
export type PositionAssignment = components['schemas']['EmployeePositionResponseDto'];
