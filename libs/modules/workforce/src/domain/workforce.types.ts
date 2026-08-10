import type {
  leaveAccrualMethodEnum,
  leaveStatusEnum,
  leaveTypeEnum,
  overtimeStatusEnum,
  shiftTypeEnum,
  timesheetStatusEnum,
} from '../../../../../db/schema';

export type TimesheetStatus = (typeof timesheetStatusEnum.enumValues)[number];
export type LeaveType = (typeof leaveTypeEnum.enumValues)[number];
/** How a year's granted days become available — see `workforce.leave_policies`. */
export type LeaveAccrualMethod = (typeof leaveAccrualMethodEnum.enumValues)[number];
export type LeaveStatus = (typeof leaveStatusEnum.enumValues)[number];
export type OvertimeStatus = (typeof overtimeStatusEnum.enumValues)[number];
export type ShiftType = (typeof shiftTypeEnum.enumValues)[number];

// ── Timesheets ───────────────────────────────────────────────────────────────
export interface Timesheet {
  id: string;
  employeeId: string;
  workDate: string;
  minutesWorked: number;
  note: string | null;
  status: TimesheetStatus;
  submittedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTimesheetInput {
  employeeId: string;
  workDate: string;
  minutesWorked: number;
  note?: string | null;
}

export interface TimesheetFilters {
  employeeId?: string;
  status?: TimesheetStatus;
}

// ── Leave ────────────────────────────────────────────────────────────────────
export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  /**
   * Working days the window costs, frozen at submit. `numeric(5,2)`, so the driver hands it back
   * as a STRING — the DTO converts. `null` only for rows predating the column.
   */
  workingDays: string | null;
  /** S3 key for a supporting document (e.g. medical cert). Null until uploaded. */
  documentStorageKey: string | null;
  status: LeaveStatus;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** Link to the universal request engine (null for legacy rows). */
  requestId: string | null;
}

export interface CreateLeaveInput {
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  /** Working days the window costs, frozen at submit — see the column's docblock. */
  workingDays?: number;
  reason?: string | null;
  requestId?: string | null;
}

export interface LeaveFilters {
  employeeId?: string;
  status?: LeaveStatus;
}

// ── Overtime ─────────────────────────────────────────────────────────────────
export interface OvertimeEntry {
  id: string;
  employeeId: string;
  workDate: string;
  hours: string;
  reason: string;
  status: OvertimeStatus;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** Link to the universal request engine (null for legacy rows). */
  requestId: string | null;
}

export interface CreateOvertimeInput {
  employeeId: string;
  workDate: string;
  hours: number;
  reason: string;
  requestId?: string | null;
}

export interface OvertimeFilters {
  employeeId?: string;
  status?: OvertimeStatus;
}

// ── Shift logs ───────────────────────────────────────────────────────────────
export interface ShiftLog {
  id: string;
  employeeId: string;
  shiftType: ShiftType;
  startsAt: Date;
  endsAt: Date;
  note: string | null;
  createdAt: Date;
}

export interface CreateShiftLogInput {
  employeeId: string;
  shiftType: ShiftType;
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
}

export interface ShiftLogFilters {
  employeeId?: string;
  shiftType?: ShiftType;
}
