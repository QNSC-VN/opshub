import type {
  CreateLeaveInput,
  CreateOvertimeInput,
  CreateShiftLogInput,
  CreateTimesheetInput,
  LeaveFilters,
  LeaveRequest,
  LeaveStatus,
  OvertimeEntry,
  OvertimeFilters,
  OvertimeStatus,
  ShiftLog,
  ShiftLogFilters,
  Timesheet,
  TimesheetFilters,
  TimesheetStatus,
} from '../workforce.types';

export const WORKFORCE_REPOSITORY = Symbol('WORKFORCE_REPOSITORY');

export interface IWorkforceRepository {
  // Timesheets
  createTimesheet(input: CreateTimesheetInput): Promise<Timesheet>;
  findTimesheetById(id: string): Promise<Timesheet | null>;
  listTimesheets(
    filters: TimesheetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Timesheet[]; total: number }>;
  setTimesheetStatus(
    id: string,
    status: TimesheetStatus,
    approvedBy: string | null,
  ): Promise<Timesheet | null>;

  // Leave
  createLeave(input: CreateLeaveInput): Promise<LeaveRequest>;
  findLeaveById(id: string): Promise<LeaveRequest | null>;
  listLeave(
    filters: LeaveFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: LeaveRequest[]; total: number }>;
  setLeaveStatus(
    id: string,
    status: LeaveStatus,
    reviewerId: string | null,
  ): Promise<LeaveRequest | null>;
  /** Backlink the engine request_items id into the domain row. */
  setLeaveRequestId(id: string, requestId: string): Promise<void>;
  /** Update the S3 object key for the leave supporting document. Pass null to clear. */
  updateLeaveDocument(id: string, documentStorageKey: string | null): Promise<void>;
  hasOverlappingLeave(
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean>;

  // Overtime
  createOvertime(input: CreateOvertimeInput): Promise<OvertimeEntry>;
  findOvertimeById(id: string): Promise<OvertimeEntry | null>;
  listOvertime(
    filters: OvertimeFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OvertimeEntry[]; total: number }>;
  setOvertimeStatus(
    id: string,
    status: OvertimeStatus,
    reviewerId: string | null,
  ): Promise<OvertimeEntry | null>;
  /** Backlink the engine request_items id into the domain row. */
  setOvertimeRequestId(id: string, requestId: string): Promise<void>;

  // Shift logs
  createShiftLog(input: CreateShiftLogInput): Promise<ShiftLog>;
  findShiftLogById(id: string): Promise<ShiftLog | null>;
  listShiftLogs(
    filters: ShiftLogFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ShiftLog[]; total: number }>;
}
