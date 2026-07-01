import type {
  timesheetStatusEnum,
  leaveTypeEnum,
  leaveStatusEnum,
  overtimeStatusEnum,
  shiftTypeEnum,
} from '../../../../../db/schema';

export type TimesheetStatus = (typeof timesheetStatusEnum.enumValues)[number];
export type LeaveType = (typeof leaveTypeEnum.enumValues)[number];
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
