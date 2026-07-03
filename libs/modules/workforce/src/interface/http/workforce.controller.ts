import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  Auth,
  RequirePermission,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageResult,
  CurrentUser,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { EmployeeService } from '@modules/identity';
import { AuditService } from '@modules/audit';
import { WorkforceService } from '../../application/workforce.service';
import {
  CreateTimesheetDto,
  ListTimesheetsQueryDto,
  TimesheetResponseDto,
  CreateLeaveDto,
  ListLeaveQueryDto,
  LeaveResponseDto,
  CreateOvertimeDto,
  ListOvertimeQueryDto,
  OvertimeResponseDto,
  CreateShiftLogDto,
  ListShiftLogsQueryDto,
  ShiftLogResponseDto,
  ReviewDto,
  SubmitOnboardingDto,
  OnboardingResponseDto,
  SubmitOffboardingDto,
  OffboardingResponseDto,
  PresignLeaveDocumentDto,
  ConfirmLeaveDocumentDto,
} from './dto/workforce.dto';
import type {
  LeaveRequest,
  OvertimeEntry,
  ShiftLog,
  Timesheet,
} from '../../domain/workforce.types';

function toTimesheetDto(t: Timesheet): TimesheetResponseDto {
  return {
    id: t.id,
    employeeId: t.employeeId,
    workDate: t.workDate,
    minutesWorked: t.minutesWorked,
    note: t.note,
    status: t.status,
    submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
    approvedBy: t.approvedBy,
    createdAt: t.createdAt.toISOString(),
  };
}

function toLeaveDto(l: LeaveRequest): LeaveResponseDto {
  return {
    id: l.id,
    employeeId: l.employeeId,
    leaveType: l.leaveType,
    startDate: l.startDate,
    endDate: l.endDate,
    reason: l.reason,
    status: l.status,
    reviewerId: l.reviewerId,
    reviewedAt: l.reviewedAt ? l.reviewedAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

function toOvertimeDto(o: OvertimeEntry): OvertimeResponseDto {
  return {
    id: o.id,
    employeeId: o.employeeId,
    workDate: o.workDate,
    hours: o.hours,
    reason: o.reason,
    status: o.status,
    reviewerId: o.reviewerId,
    reviewedAt: o.reviewedAt ? o.reviewedAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
  };
}

function toShiftLogDto(s: ShiftLog): ShiftLogResponseDto {
  return {
    id: s.id,
    employeeId: s.employeeId,
    shiftType: s.shiftType,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    note: s.note,
    createdAt: s.createdAt.toISOString(),
  };
}

@ApiTags('workforce')
@Controller('workforce')
@Auth()
export class WorkforceController {
  constructor(
    private readonly service: WorkforceService,
    private readonly audit: AuditService,
    private readonly employeeService: EmployeeService,
  ) {}

  // ── Timesheets ─────────────────────────────────────────────────────────────
  @Get('timesheets')
  @ApiOperation({ summary: 'List timesheets' })
  @ApiPagedResponse(TimesheetResponseDto)
  @ApiCommonErrors(401)
  async listTimesheets(
    @Query() query: ListTimesheetsQueryDto,
  ): Promise<PagedResult<TimesheetResponseDto>> {
    const { rows, total } = await this.service.listTimesheets(
      { employeeId: query.employeeId, status: query.status },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toTimesheetDto), total, query.limit, query.offset);
  }

  @Post('timesheets')
  @ApiOperation({ summary: 'Create a draft timesheet for the current user' })
  @ApiCommonErrors(401, 422)
  async createTimesheet(
    @Body() dto: CreateTimesheetDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TimesheetResponseDto> {
    const ts = await this.service.createTimesheet(dto, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.timesheet_created',
      resourceType: 'timesheet',
      resourceId: ts.id,
      metadata: { workDate: dto.workDate, minutesWorked: dto.minutesWorked },
    });
    return toTimesheetDto(ts);
  }

  @Post('timesheets/:id/submit')
  @ApiOperation({ summary: 'Submit a timesheet for approval' })
  @ApiCommonErrors(401, 404, 412)
  async submitTimesheet(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<TimesheetResponseDto> {
    const ts = await this.service.submitTimesheet(id, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.timesheet_submitted',
      resourceType: 'timesheet',
      resourceId: id,
    });
    return toTimesheetDto(ts);
  }

  @Post('timesheets/:id/review')
  @RequirePermission('workforce.approve')
  @ApiOperation({ summary: 'Approve or reject a timesheet' })
  @ApiCommonErrors(401, 403, 404, 412)
  async reviewTimesheet(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TimesheetResponseDto> {
    const ts = await this.service.reviewTimesheet(id, dto.approve, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: dto.approve ? 'workforce.timesheet_approved' : 'workforce.timesheet_rejected',
      resourceType: 'timesheet',
      resourceId: id,
    });
    return toTimesheetDto(ts);
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  @Get('leave')
  @ApiOperation({ summary: 'List leave requests' })
  @ApiPagedResponse(LeaveResponseDto)
  @ApiCommonErrors(401)
  async listLeave(@Query() query: ListLeaveQueryDto): Promise<PagedResult<LeaveResponseDto>> {
    const { rows, total } = await this.service.listLeave(
      { employeeId: query.employeeId, status: query.status },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toLeaveDto), total, query.limit, query.offset);
  }

  @Post('leave')
  @ApiOperation({ summary: 'Request leave for the current user' })
  @ApiCommonErrors(401, 409, 412, 422)
  async createLeave(
    @Body() dto: CreateLeaveDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<LeaveResponseDto> {
    const leave = await this.service.createLeave(dto, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.leave_requested',
      resourceType: 'leave_request',
      resourceId: leave.id,
      metadata: { leaveType: dto.leaveType, startDate: dto.startDate, endDate: dto.endDate },
    });
    return toLeaveDto(leave);
  }

  @Post('leave/:id/review')
  @RequirePermission('workforce.approve')
  @ApiOperation({ summary: 'Approve or reject a leave request' })
  @ApiCommonErrors(401, 403, 404, 412)
  async reviewLeave(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<LeaveResponseDto> {
    const leave = await this.service.reviewLeave(id, dto.approve, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: dto.approve ? 'workforce.leave_approved' : 'workforce.leave_rejected',
      resourceType: 'leave_request',
      resourceId: id,
    });
    return toLeaveDto(leave);
  }

  @Post('leave/:id/cancel')
  @ApiOperation({ summary: 'Cancel a leave request' })
  @ApiCommonErrors(401, 404, 412)
  async cancelLeave(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<LeaveResponseDto> {
    const leave = await this.service.cancelLeave(id, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.leave_cancelled',
      resourceType: 'leave_request',
      resourceId: id,
    });
    return toLeaveDto(leave);
  }

  // ── Overtime ───────────────────────────────────────────────────────────────
  @Get('overtime')
  @ApiOperation({ summary: 'List overtime entries' })
  @ApiPagedResponse(OvertimeResponseDto)
  @ApiCommonErrors(401)
  async listOvertime(
    @Query() query: ListOvertimeQueryDto,
  ): Promise<PagedResult<OvertimeResponseDto>> {
    const { rows, total } = await this.service.listOvertime(
      { employeeId: query.employeeId, status: query.status },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toOvertimeDto), total, query.limit, query.offset);
  }

  @Post('overtime')
  @ApiOperation({ summary: 'Log overtime for the current user' })
  @ApiCommonErrors(401, 422)
  async createOvertime(
    @Body() dto: CreateOvertimeDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OvertimeResponseDto> {
    const entry = await this.service.createOvertime(dto, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.overtime_logged',
      resourceType: 'overtime_entry',
      resourceId: entry.id,
      metadata: { workDate: dto.workDate, hours: dto.hours },
    });
    return toOvertimeDto(entry);
  }

  @Post('overtime/:id/review')
  @RequirePermission('workforce.approve')
  @ApiOperation({ summary: 'Approve or reject an overtime entry' })
  @ApiCommonErrors(401, 403, 404, 412)
  async reviewOvertime(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OvertimeResponseDto> {
    const entry = await this.service.reviewOvertime(id, dto.approve, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: dto.approve ? 'workforce.overtime_approved' : 'workforce.overtime_rejected',
      resourceType: 'overtime_entry',
      resourceId: id,
    });
    return toOvertimeDto(entry);
  }

  // ── Shift logs ─────────────────────────────────────────────────────────────
  @Get('shifts')
  @ApiOperation({ summary: 'List night/on-call/weekend shift logs' })
  @ApiPagedResponse(ShiftLogResponseDto)
  @ApiCommonErrors(401)
  async listShifts(
    @Query() query: ListShiftLogsQueryDto,
  ): Promise<PagedResult<ShiftLogResponseDto>> {
    const { rows, total } = await this.service.listShiftLogs(
      { employeeId: query.employeeId, shiftType: query.shiftType },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toShiftLogDto), total, query.limit, query.offset);
  }

  @Post('shifts')
  @ApiOperation({ summary: 'Log a worked shift for the current user' })
  @ApiCommonErrors(401, 412, 422)
  async createShift(
    @Body() dto: CreateShiftLogDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ShiftLogResponseDto> {
    const shift = await this.service.createShiftLog(
      { ...dto, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) },
      user,
    );
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'workforce.shift_logged',
      resourceType: 'shift_log',
      resourceId: shift.id,
      metadata: { shiftType: dto.shiftType, startsAt: dto.startsAt, endsAt: dto.endsAt },
    });
    return toShiftLogDto(shift);
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  @Post('onboarding')
  @RequirePermission('onboarding.approve')
  @ApiOperation({ summary: 'Submit a 3-step onboarding request for a new employee' })
  @ApiResponse({ status: 201, type: OnboardingResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async submitOnboarding(
    @Body() dto: SubmitOnboardingDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OnboardingResponseDto> {
    const employee = await this.employeeService.getById(dto.employeeId);
    const requestId = await this.service.submitOnboarding(
      {
        employeeId: employee.id,
        employeeEmail: employee.email,
        startDate: dto.startDate,
        department: dto.department,
        jobTitle: dto.jobTitle,
        managerName: dto.managerName,
        equipmentType: dto.equipmentType,
        preferredOs: dto.preferredOs,
        equipmentNote: dto.equipmentNote,
        accessNeeds: dto.accessNeeds,
      },
      user,
    );
    return { requestId };
  }

  // ── Offboarding ────────────────────────────────────────────────────────────

  @Post('offboarding')
  @RequirePermission('offboarding.approve')
  @ApiOperation({ summary: 'Submit an offboarding request — revokes all access on approval' })
  @ApiResponse({ status: 201, type: OffboardingResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async submitOffboarding(
    @Body() dto: SubmitOffboardingDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OffboardingResponseDto> {
    const employee = await this.employeeService.getById(dto.employeeId);
    const requestId = await this.service.submitOffboarding(
      {
        employeeId: employee.id,
        employeeEmail: employee.email,
        reason: dto.reason,
      },
      user,
    );
    return { requestId };
  }

  // ── Leave document upload ─────────────────────────────────────────────

  @Post('leave-requests/:id/document/presign')
  @ApiOperation({
    summary:
      'Get a presigned S3 PUT URL to upload a leave supporting document (e.g. medical certificate)',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        fileId: { type: 'string' },
        uploadUrl: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['fileId', 'uploadUrl', 'key'],
    },
  })
  @ApiCommonErrors(401, 404, 422)
  async presignLeaveDocument(
    @Param('id') id: string,
    @Body() dto: PresignLeaveDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.presignLeaveDocument(id, dto, user);
  }

  @Post('leave-requests/:id/document/confirm')
  @ApiOperation({ summary: 'Confirm leave document upload completed' })
  @ApiResponse({
    status: 200,
    schema: { properties: { documentUrl: { type: 'string' } }, required: ['documentUrl'] },
  })
  @ApiCommonErrors(401, 404, 422)
  async confirmLeaveDocument(
    @Param('id') id: string,
    @Body() dto: ConfirmLeaveDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.confirmLeaveDocument(id, dto.fileId, user);
  }

  @Get('leave-requests/:id/document')
  @ApiOperation({ summary: 'Get a time-limited download URL for the leave supporting document' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: { documentUrl: { type: 'string', nullable: true } },
      required: ['documentUrl'],
    },
  })
  @ApiCommonErrors(401, 404)
  async getLeaveDocumentUrl(@Param('id') id: string) {
    return this.service.getLeaveDocumentUrl(id);
  }
}
