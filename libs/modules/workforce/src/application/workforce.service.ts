import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
  ErrorCodes,
  RequestEngine,
  StorageService,
} from '@platform';
import type { PresignUploadResult } from '@platform';
import { AuditService } from '@modules/audit';
import { MS_PER_HOUR } from '@shared-kernel';
import {
  WORKFORCE_REPOSITORY,
  type IWorkforceRepository,
} from '../domain/ports/workforce.repository';
import type {
  CreateLeaveInput,
  CreateOvertimeInput,
  CreateShiftLogInput,
  CreateTimesheetInput,
  LeaveFilters,
  LeaveRequest,
  OvertimeEntry,
  OvertimeFilters,
  ShiftLog,
  ShiftLogFilters,
  Timesheet,
  TimesheetFilters,
} from '../domain/workforce.types';
import type { LeaveRequestPayload } from './leave-request.type-def';
import type { OvertimePayload } from './overtime.type-def';
import type { OnboardingPayload } from './onboarding.type-def';
import type { OffboardingPayload } from './offboarding.type-def';

type Actor = { sub: string; email: string };

@Injectable()
export class WorkforceService {
  constructor(
    @Inject(WORKFORCE_REPOSITORY) private readonly repo: IWorkforceRepository,
    private readonly audit: AuditService,
    private readonly engine: RequestEngine,
    private readonly storage: StorageService,
  ) {}

  // ── Timesheets ─────────────────────────────────────────────────────────────
  async createTimesheet(
    input: Omit<CreateTimesheetInput, 'employeeId'>,
    actor: Actor,
  ): Promise<Timesheet> {
    return this.repo.createTimesheet({ ...input, employeeId: actor.sub });
  }

  async getTimesheet(id: string): Promise<Timesheet> {
    const t = await this.repo.findTimesheetById(id);
    if (!t) throw new NotFoundException(ErrorCodes.TIMESHEET_NOT_FOUND, 'Timesheet not found');
    return t;
  }

  async listTimesheets(
    filters: TimesheetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Timesheet[]; total: number }> {
    return this.repo.listTimesheets(filters, limit, offset);
  }

  async submitTimesheet(id: string, _actor: Actor): Promise<Timesheet> {
    const t = await this.getTimesheet(id);
    if (t.status !== 'draft' && t.status !== 'rejected') {
      throw new PreconditionFailedException(
        ErrorCodes.TIMESHEET_NOT_EDITABLE,
        'Only draft or rejected timesheets can be submitted',
      );
    }
    const updated = await this.repo.setTimesheetStatus(id, 'submitted', null);
    return updated!;
  }

  async reviewTimesheet(id: string, approve: boolean, actor: Actor): Promise<Timesheet> {
    const t = await this.getTimesheet(id);
    if (t.status !== 'submitted') {
      throw new PreconditionFailedException(
        ErrorCodes.TIMESHEET_NOT_EDITABLE,
        'Only submitted timesheets can be reviewed',
      );
    }
    const updated = await this.repo.setTimesheetStatus(
      id,
      approve ? 'approved' : 'rejected',
      approve ? actor.sub : null,
    );
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: approve ? 'timesheet.approved' : 'timesheet.rejected',
      resourceType: 'timesheet',
      resourceId: id,
    });
    return updated!;
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  async createLeave(input: Omit<CreateLeaveInput, 'employeeId'>, actor: Actor): Promise<LeaveRequest> {
    if (input.startDate > input.endDate) {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'startDate must be on or before endDate',
      );
    }
    const overlaps = await this.repo.hasOverlappingLeave(
      actor.sub,
      input.startDate,
      input.endDate,
    );
    if (overlaps) {
      throw new ConflictException(
        ErrorCodes.LEAVE_OVERLAPPING,
        'You already have a leave request overlapping these dates',
      );
    }

    // Create domain row first, then submit to engine
    const leave = await this.repo.createLeave({ ...input, employeeId: actor.sub });

    const enginePayload: LeaveRequestPayload = {
      leaveRequestId: leave.id,
      employeeId: actor.sub,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      reason: leave.reason,
    };
    const engineItem = await this.engine.submit('leave_request', enginePayload, actor, {
      expiresAt: new Date(Date.now() + 72 * MS_PER_HOUR), // 3-day review window
    });

    await this.repo.setLeaveRequestId(leave.id, engineItem.id);

    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'leave.requested',
      resourceType: 'leave_request',
      resourceId: leave.id,
      metadata: { leaveType: leave.leaveType, startDate: leave.startDate, endDate: leave.endDate, engineRequestId: engineItem.id },
    });
    return { ...leave, requestId: engineItem.id };
  }

  async getLeave(id: string): Promise<LeaveRequest> {
    const l = await this.repo.findLeaveById(id);
    if (!l) throw new NotFoundException(ErrorCodes.LEAVE_REQUEST_NOT_FOUND, 'Leave request not found');
    return l;
  }

  async listLeave(
    filters: LeaveFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: LeaveRequest[]; total: number }> {
    return this.repo.listLeave(filters, limit, offset);
  }

  async reviewLeave(id: string, approve: boolean, actor: Actor): Promise<LeaveRequest> {
    const l = await this.getLeave(id);
    if (l.status !== 'pending') {
      throw new PreconditionFailedException(
        ErrorCodes.LEAVE_REQUEST_NOT_PENDING,
        'Only pending leave requests can be reviewed',
      );
    }

    if (l.requestId) {
      if (approve) {
        await this.engine.approve(l.requestId, null, actor);
      } else {
        await this.engine.reject(l.requestId, null, actor);
      }
    } else {
      // Legacy path
      const updated = await this.repo.setLeaveStatus(id, approve ? 'approved' : 'rejected', actor.sub);
      await this.audit.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        action: approve ? 'leave.approved' : 'leave.rejected',
        resourceType: 'leave_request',
        resourceId: id,
      });
      return updated!;
    }

    return this.getLeave(id);
  }

  async cancelLeave(id: string, _actor: Actor): Promise<LeaveRequest> {
    const l = await this.getLeave(id);
    if (l.status !== 'pending' && l.status !== 'approved') {
      throw new PreconditionFailedException(
        ErrorCodes.LEAVE_REQUEST_NOT_PENDING,
        'Only pending or approved leave can be cancelled',
      );
    }
    const updated = await this.repo.setLeaveStatus(id, 'cancelled', null);
    return updated!;
  }

  // ── Overtime ───────────────────────────────────────────────────────────────
  async createOvertime(
    input: Omit<CreateOvertimeInput, 'employeeId'>,
    actor: Actor,
  ): Promise<OvertimeEntry> {
    const entry = await this.repo.createOvertime({ ...input, employeeId: actor.sub });

    const enginePayload: OvertimePayload = {
      overtimeId: entry.id,
      employeeId: actor.sub,
      workDate: entry.workDate,
      hours: input.hours,
      reason: entry.reason,
    };
    const engineItem = await this.engine.submit('overtime', enginePayload, actor, {
      expiresAt: new Date(Date.now() + 72 * MS_PER_HOUR), // 3-day review window
    });

    await this.repo.setOvertimeRequestId(entry.id, engineItem.id);

    return { ...entry, requestId: engineItem.id };
  }

  async getOvertime(id: string): Promise<OvertimeEntry> {
    const o = await this.repo.findOvertimeById(id);
    if (!o) throw new NotFoundException(ErrorCodes.OVERTIME_NOT_FOUND, 'Overtime entry not found');
    return o;
  }

  async listOvertime(
    filters: OvertimeFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OvertimeEntry[]; total: number }> {
    return this.repo.listOvertime(filters, limit, offset);
  }

  async reviewOvertime(id: string, approve: boolean, actor: Actor): Promise<OvertimeEntry> {
    const o = await this.getOvertime(id);
    if (o.status !== 'pending') {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'Only pending overtime entries can be reviewed',
      );
    }

    if (o.requestId) {
      if (approve) {
        await this.engine.approve(o.requestId, null, actor);
      } else {
        await this.engine.reject(o.requestId, null, actor);
      }
    } else {
      // Legacy path
      const updated = await this.repo.setOvertimeStatus(id, approve ? 'approved' : 'rejected', actor.sub);
      await this.audit.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        action: approve ? 'overtime.approved' : 'overtime.rejected',
        resourceType: 'overtime_entry',
        resourceId: id,
      });
      return updated!;
    }

    return this.getOvertime(id);
  }

  // ── Shift logs ─────────────────────────────────────────────────────────────
  async createShiftLog(
    input: Omit<CreateShiftLogInput, 'employeeId'>,
    actor: Actor,
  ): Promise<ShiftLog> {
    if (input.startsAt >= input.endsAt) {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'startsAt must be before endsAt',
      );
    }
    return this.repo.createShiftLog({ ...input, employeeId: actor.sub });
  }

  async getShiftLog(id: string): Promise<ShiftLog> {
    const s = await this.repo.findShiftLogById(id);
    if (!s) throw new NotFoundException(ErrorCodes.SHIFT_LOG_NOT_FOUND, 'Shift log not found');
    return s;
  }

  async listShiftLogs(
    filters: ShiftLogFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ShiftLog[]; total: number }> {
    return this.repo.listShiftLogs(filters, limit, offset);
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  /**
   * Submit a multi-step onboarding request for a new employee.
   * Steps: manager approve → IT provision → HR complete.
   * Returns the engine request ID so the caller can track progress.
   */
  async submitOnboarding(
    input: {
      employeeId: string;
      employeeEmail: string;
      startDate: string;
      department?: string;
      jobTitle?: string;
      managerName?: string;
      equipmentType?: string;
      preferredOs?: string;
      equipmentNote?: string;
      accessNeeds?: string[];
    },
    actor: Actor,
  ): Promise<string> {
    const payload: OnboardingPayload = {
      employeeId: input.employeeId,
      employeeEmail: input.employeeEmail,
      startDate: input.startDate,
      ...(input.department && { department: input.department }),
      ...(input.jobTitle && { jobTitle: input.jobTitle }),
      ...(input.managerName && { managerName: input.managerName }),
      ...(input.equipmentType && { equipmentType: input.equipmentType }),
      ...(input.preferredOs && { preferredOs: input.preferredOs }),
      ...(input.equipmentNote && { equipmentNote: input.equipmentNote }),
      ...(input.accessNeeds?.length && { accessNeeds: input.accessNeeds }),
    };
    const item = await this.engine.submit('onboarding', payload, actor);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'workforce.onboarding_submitted',
      resourceType: 'employee',
      resourceId: input.employeeId,
      metadata: { requestId: item.id, startDate: input.startDate },
    });
    return item.id;
  }

  // ── Offboarding ────────────────────────────────────────────────────────────

  /**
   * Submit an offboarding request for an employee.
   * On approval: status → offboarded, roles revoked, grants revoked,
   * assets returned, sessions invalidated — all atomically.
   */
  async submitOffboarding(
    input: { employeeId: string; employeeEmail: string; reason?: string },
    actor: Actor,
  ): Promise<string> {
    const payload: OffboardingPayload = {
      employeeId: input.employeeId,
      employeeEmail: input.employeeEmail,
      ...(input.reason && { reason: input.reason }),
    };
    const item = await this.engine.submit('offboarding', payload, actor);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'workforce.offboarding_submitted',
      resourceType: 'employee',
      resourceId: input.employeeId,
      metadata: { requestId: item.id, reason: input.reason },
    });
    return item.id;
  }

  // ── Leave document upload ─────────────────────────────────────────────────

  /** Step 1 — returns a presigned S3 PUT URL for the client to upload to. */
  async presignLeaveDocument(
    leaveId: string,
    input: { fileName: string; mimeType: string; sizeBytes: number },
    actor: Actor,
  ): Promise<PresignUploadResult> {
    const leave = await this.repo.findLeaveById(leaveId);
    if (!leave) throw new NotFoundException(ErrorCodes.LEAVE_REQUEST_NOT_FOUND, 'Leave request not found');
    return this.storage.presignUpload(
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        resourceType: 'leave-document',
        linkedEntityType: 'leave_request',
        linkedEntityId: leaveId,
      },
      actor.sub,
    );
  }

  /** Step 3 — verify upload and link the S3 key to the leave request. */
  async confirmLeaveDocument(
    leaveId: string,
    fileId: string,
    actor: Actor,
  ): Promise<{ documentUrl: string }> {
    const leave = await this.repo.findLeaveById(leaveId);
    if (!leave) throw new NotFoundException(ErrorCodes.LEAVE_REQUEST_NOT_FOUND, 'Leave request not found');

    const result = await this.storage.confirmUpload(fileId, actor.sub);

    // Soft-delete old document if replaced
    if (leave.documentStorageKey) {
      const old = await this.storage.findById(leave.documentStorageKey);
      if (old) void this.storage.deleteFile(old.id, old.uploaderId);
    }

    await this.repo.updateLeaveDocument(leaveId, result.key);

    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'leave.document_uploaded',
      resourceType: 'leave_request',
      resourceId: leaveId,
    });

    return { documentUrl: result.url };
  }

  /** Returns a time-limited download URL for the leave supporting document. */
  async getLeaveDocumentUrl(leaveId: string): Promise<{ documentUrl: string | null }> {
    const leave = await this.repo.findLeaveById(leaveId);
    if (!leave) throw new NotFoundException(ErrorCodes.LEAVE_REQUEST_NOT_FOUND, 'Leave request not found');
    if (!leave.documentStorageKey) return { documentUrl: null };
    const url = await this.storage.presignGet(leave.documentStorageKey);
    return { documentUrl: url };
  }
}
