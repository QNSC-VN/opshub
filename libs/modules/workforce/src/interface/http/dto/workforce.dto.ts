import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { timesheetStatusEnum, leaveTypeEnum, leaveStatusEnum, overtimeStatusEnum, shiftTypeEnum } from '@db/schema/enums';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// ── Timesheets ───────────────────────────────────────────────────────────────
export const CreateTimesheetSchema = z.object({
  workDate: dateStr,
  minutesWorked: z.number().int().min(0).max(1440),
  note: z.string().max(500).optional(),
});
export class CreateTimesheetDto extends createZodDto(CreateTimesheetSchema) {}

export const ListTimesheetsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(timesheetStatusEnum.enumValues).optional(),
}).merge(PaginationQuerySchema);
export class ListTimesheetsQueryDto extends createZodDto(ListTimesheetsQuerySchema) {}

export class TimesheetResponseDto {
  id!: string;
  employeeId!: string;
  workDate!: string;
  minutesWorked!: number;
  note!: string | null;
  status!: string;
  submittedAt!: string | null;
  approvedBy!: string | null;
  createdAt!: string;
}

// ── Leave ────────────────────────────────────────────────────────────────────
export const CreateLeaveSchema = z
  .object({
    leaveType: z.enum(leaveTypeEnum.enumValues),
    startDate: dateStr,
    endDate: dateStr,
    reason: z.string().max(1000).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });
export class CreateLeaveDto extends createZodDto(CreateLeaveSchema) {}

export const ListLeaveQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(leaveStatusEnum.enumValues).optional(),
}).merge(PaginationQuerySchema);
export class ListLeaveQueryDto extends createZodDto(ListLeaveQuerySchema) {}

export class LeaveResponseDto {
  id!: string;
  employeeId!: string;
  leaveType!: string;
  startDate!: string;
  endDate!: string;
  reason!: string | null;
  status!: string;
  reviewerId!: string | null;
  reviewedAt!: string | null;
  createdAt!: string;
}

// ── Overtime ─────────────────────────────────────────────────────────────────
export const CreateOvertimeSchema = z.object({
  workDate: dateStr,
  hours: z.number().min(0.25).max(24),
  reason: z.string().min(1).max(1000),
});
export class CreateOvertimeDto extends createZodDto(CreateOvertimeSchema) {}

export const ListOvertimeQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(overtimeStatusEnum.enumValues).optional(),
}).merge(PaginationQuerySchema);
export class ListOvertimeQueryDto extends createZodDto(ListOvertimeQuerySchema) {}

export class OvertimeResponseDto {
  id!: string;
  employeeId!: string;
  workDate!: string;
  hours!: string;
  reason!: string;
  status!: string;
  reviewerId!: string | null;
  reviewedAt!: string | null;
  createdAt!: string;
}

// ── Shift logs ───────────────────────────────────────────────────────────────
export const CreateShiftLogSchema = z
  .object({
    shiftType: z.enum(shiftTypeEnum.enumValues),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.startsAt < v.endsAt, {
    message: 'startsAt must be before endsAt',
    path: ['endsAt'],
  });
export class CreateShiftLogDto extends createZodDto(CreateShiftLogSchema) {}

export const ListShiftLogsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  shiftType: z.enum(shiftTypeEnum.enumValues).optional(),
}).merge(PaginationQuerySchema);
export class ListShiftLogsQueryDto extends createZodDto(ListShiftLogsQuerySchema) {}

export class ShiftLogResponseDto {
  id!: string;
  employeeId!: string;
  shiftType!: string;
  startsAt!: string;
  endsAt!: string;
  note!: string | null;
  createdAt!: string;
}

// ── Review ───────────────────────────────────────────────────────────────────
export const ReviewSchema = z.object({ approve: z.boolean() });
export class ReviewDto extends createZodDto(ReviewSchema) {}

// ── Onboarding ───────────────────────────────────────────────────────────────
export const SubmitOnboardingSchema = z.object({
  /** UUID of the employee being onboarded. */
  employeeId: z.string().uuid(),
  /** Planned start date (YYYY-MM-DD). */
  startDate: dateStr,
  department: z.string().max(120).optional(),
  jobTitle: z.string().max(120).optional(),
  /** Display name of the direct manager (informational, for IT provisioning context). */
  managerName: z.string().max(120).optional(),
  /** Requested device form-factor: laptop | desktop | remote_only | byod */
  equipmentType: z.enum(['laptop', 'desktop', 'remote_only', 'byod']).optional(),
  /** Preferred OS: windows | macos | linux */
  preferredOs: z.enum(['windows', 'macos', 'linux']).optional(),
  /** Free-text equipment notes for IT (peripherals, special requirements, etc.). */
  equipmentNote: z.string().max(500).optional(),
  /** Systems / apps the new hire needs access to on day one. */
  accessNeeds: z.array(z.string().max(80)).max(20).optional(),
});
export class SubmitOnboardingDto extends createZodDto(SubmitOnboardingSchema) {}

export class OnboardingResponseDto {
  /** Engine request ID — use this to track approval progress. */
  requestId!: string;
}

// ── Offboarding ───────────────────────────────────────────────────────────────
export const SubmitOffboardingSchema = z.object({
  /** UUID of the employee being offboarded. */
  employeeId: z.string().uuid(),
  /** Optional reason / business justification. */
  reason: z.string().max(1000).optional(),
});
export class SubmitOffboardingDto extends createZodDto(SubmitOffboardingSchema) {}

export class OffboardingResponseDto {
  /** Engine request ID — use this to track approval progress. */
  requestId!: string;
}

export const PresignLeaveDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
});
export class PresignLeaveDocumentDto extends createZodDto(PresignLeaveDocumentSchema) {}

export const ConfirmLeaveDocumentSchema = z.object({
  fileId: z.string().uuid(),
});
export class ConfirmLeaveDocumentDto extends createZodDto(ConfirmLeaveDocumentSchema) {}
