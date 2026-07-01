import { Injectable } from '@nestjs/common';
import { and, desc, eq, lte, gte, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import {
  timesheets,
  leaveRequests,
  overtimeEntries,
  shiftLogs,
} from '../../../../../../db/schema';
import type { IWorkforceRepository } from '../../domain/ports/workforce.repository';
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
} from '../../domain/workforce.types';

@Injectable()
export class WorkforceDrizzleRepository implements IWorkforceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── Timesheets ─────────────────────────────────────────────────────────────
  async createTimesheet(input: CreateTimesheetInput): Promise<Timesheet> {
    const [row] = await this.db
      .insert(timesheets)
      .values({
        id: newId(),
        employeeId: input.employeeId,
        workDate: input.workDate,
        minutesWorked: input.minutesWorked,
        note: input.note ?? null,
      })
      .returning();
    return row as Timesheet;
  }

  async findTimesheetById(id: string): Promise<Timesheet | null> {
    const [row] = await this.db.select().from(timesheets).where(eq(timesheets.id, id)).limit(1);
    return (row as Timesheet) ?? null;
  }

  async listTimesheets(
    filters: TimesheetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Timesheet[]; total: number }> {
    const conditions = [
      filters.employeeId ? eq(timesheets.employeeId, filters.employeeId) : undefined,
      filters.status ? eq(timesheets.status, filters.status) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(timesheets)
      .where(where)
      .orderBy(desc(timesheets.workDate))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(timesheets)
      .where(where);
    return { rows: rows as Timesheet[], total: count };
  }

  async setTimesheetStatus(
    id: string,
    status: TimesheetStatus,
    approvedBy: string | null,
  ): Promise<Timesheet | null> {
    const [row] = await this.db
      .update(timesheets)
      .set({
        status,
        approvedBy: status === 'approved' ? approvedBy : null,
        submittedAt: status === 'submitted' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(timesheets.id, id))
      .returning();
    return (row as Timesheet) ?? null;
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  async createLeave(input: CreateLeaveInput): Promise<LeaveRequest> {
    const [row] = await this.db
      .insert(leaveRequests)
      .values({
        id: newId(),
        employeeId: input.employeeId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
      })
      .returning();
    return row as LeaveRequest;
  }

  async findLeaveById(id: string): Promise<LeaveRequest | null> {
    const [row] = await this.db
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, id))
      .limit(1);
    return (row as LeaveRequest) ?? null;
  }

  async listLeave(
    filters: LeaveFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: LeaveRequest[]; total: number }> {
    const conditions = [
      filters.employeeId ? eq(leaveRequests.employeeId, filters.employeeId) : undefined,
      filters.status ? eq(leaveRequests.status, filters.status) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(leaveRequests)
      .where(where)
      .orderBy(desc(leaveRequests.startDate))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(where);
    return { rows: rows as LeaveRequest[], total: count };
  }

  async setLeaveStatus(
    id: string,
    status: LeaveStatus,
    reviewerId: string | null,
  ): Promise<LeaveRequest | null> {
    const reviewed = status === 'approved' || status === 'rejected';
    const [row] = await this.db
      .update(leaveRequests)
      .set({
        status,
        reviewerId: reviewed ? reviewerId : null,
        reviewedAt: reviewed ? new Date() : null,
      })
      .where(eq(leaveRequests.id, id))
      .returning();
    return (row as LeaveRequest) ?? null;
  }

  async setLeaveRequestId(id: string, requestId: string): Promise<void> {
    await this.db
      .update(leaveRequests)
      .set({ requestId })
      .where(eq(leaveRequests.id, id));
  }

  async updateLeaveDocument(id: string, documentStorageKey: string | null): Promise<void> {
    await this.db
      .update(leaveRequests)
      .set({ documentStorageKey })
      .where(eq(leaveRequests.id, id));
  }

  async hasOverlappingLeave(
    employeeId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          sql`${leaveRequests.status} in ('pending','approved')`,
          lte(leaveRequests.startDate, endDate),
          gte(leaveRequests.endDate, startDate),
        ),
      );
    return (row?.count ?? 0) > 0;
  }

  // ── Overtime ───────────────────────────────────────────────────────────────
  async createOvertime(input: CreateOvertimeInput): Promise<OvertimeEntry> {
    const [row] = await this.db
      .insert(overtimeEntries)
      .values({
        id: newId(),
        employeeId: input.employeeId,
        workDate: input.workDate,
        hours: String(input.hours),
        reason: input.reason,
        requestId: input.requestId ?? null,
      })
      .returning();
    return row as OvertimeEntry;
  }

  async findOvertimeById(id: string): Promise<OvertimeEntry | null> {
    const [row] = await this.db
      .select()
      .from(overtimeEntries)
      .where(eq(overtimeEntries.id, id))
      .limit(1);
    return (row as OvertimeEntry) ?? null;
  }

  async listOvertime(
    filters: OvertimeFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OvertimeEntry[]; total: number }> {
    const conditions = [
      filters.employeeId ? eq(overtimeEntries.employeeId, filters.employeeId) : undefined,
      filters.status ? eq(overtimeEntries.status, filters.status) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(overtimeEntries)
      .where(where)
      .orderBy(desc(overtimeEntries.workDate))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(overtimeEntries)
      .where(where);
    return { rows: rows as OvertimeEntry[], total: count };
  }

  async setOvertimeStatus(
    id: string,
    status: OvertimeStatus,
    reviewerId: string | null,
  ): Promise<OvertimeEntry | null> {
    const reviewed = status === 'approved' || status === 'rejected';
    const [row] = await this.db
      .update(overtimeEntries)
      .set({
        status,
        reviewerId: reviewed ? reviewerId : null,
        reviewedAt: reviewed ? new Date() : null,
      })
      .where(eq(overtimeEntries.id, id))
      .returning();
    return (row as OvertimeEntry) ?? null;
  }

  async setOvertimeRequestId(id: string, requestId: string): Promise<void> {
    await this.db
      .update(overtimeEntries)
      .set({ requestId })
      .where(eq(overtimeEntries.id, id));
  }

  // ── Shift logs ─────────────────────────────────────────────────────────────
  async createShiftLog(input: CreateShiftLogInput): Promise<ShiftLog> {
    const [row] = await this.db
      .insert(shiftLogs)
      .values({
        id: newId(),
        employeeId: input.employeeId,
        shiftType: input.shiftType,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note ?? null,
      })
      .returning();
    return row as ShiftLog;
  }

  async findShiftLogById(id: string): Promise<ShiftLog | null> {
    const [row] = await this.db.select().from(shiftLogs).where(eq(shiftLogs.id, id)).limit(1);
    return (row as ShiftLog) ?? null;
  }

  async listShiftLogs(
    filters: ShiftLogFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ShiftLog[]; total: number }> {
    const conditions = [
      filters.employeeId ? eq(shiftLogs.employeeId, filters.employeeId) : undefined,
      filters.shiftType ? eq(shiftLogs.shiftType, filters.shiftType) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(shiftLogs)
      .where(where)
      .orderBy(desc(shiftLogs.startsAt))
      .limit(limit)
      .offset(offset);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shiftLogs)
      .where(where);
    return { rows: rows as ShiftLog[], total: count };
  }
}
