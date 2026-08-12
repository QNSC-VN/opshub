import type { positionStatusEnum } from '../../../../../db/schema';
/** Derived from the DB enum so adding a value there cannot leave this list stale. */
export type PositionStatus = (typeof positionStatusEnum.enumValues)[number];

export interface Position {
  id: string;
  code: string;
  title: string;
  department: string;
  level: string | null;
  headcount: number;
  description: string | null;
  status: PositionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeePosition {
  id: string;
  employeeId: string;
  positionId: string;
  effectiveFrom: string;
  /** Null while current. Set on transfer or departure — the row is never deleted. */
  effectiveTo: string | null;
  endReason: string | null;
  createdAt: Date;
}

export interface CreatePositionInput {
  code: string;
  title: string;
  department: string;
  level?: string | null;
  headcount?: number;
  description?: string | null;
}

export interface PositionFilters {
  /** Free text over title, code and department. */
  search?: string;
  department?: string;
  status?: PositionStatus;
  /** Only positions with at least one unfilled approved slot. */
  vacantOnly?: boolean;
}

/**
 * A position with its occupancy — the number a headcount plan is actually about.
 *
 * `filled` counts OPEN assignments, so someone who left last month is not still occupying a slot.
 * `vacancies` is `headcount - filled`, floored at zero: it can go negative in the data if an
 * approved headcount is REDUCED below current occupancy, which is a real situation (a restructure)
 * and must not be reported as a negative vacancy.
 */
export interface PositionOccupancy extends Position {
  filled: number;
  vacancies: number;
}
