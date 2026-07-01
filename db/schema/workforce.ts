/**
 * workforce schema — timesheets, leave, overtime and night/on-call shift logs.
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import {
  timesheetStatusEnum,
  leaveTypeEnum,
  leaveStatusEnum,
  overtimeStatusEnum,
  shiftTypeEnum,
} from './enums';
import { requestItems } from './requests';

export const workforceSchema = pgSchema('workforce');

export const timesheets = workforceSchema.table(
  'timesheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    /** Worked minutes for the day (kept as integer to avoid float drift). */
    minutesWorked: integer('minutes_worked').notNull().default(0),
    note: varchar('note', { length: 500 }),
    status: timesheetStatusEnum('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeDateIdx: index('ix_timesheet_employee_date').on(t.employeeId, t.workDate),
    statusIdx: index('ix_timesheet_status').on(t.status),
  }),
);

export const leaveRequests = workforceSchema.table(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    leaveType: leaveTypeEnum('leave_type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: text('reason'),
    /** S3 key for a supporting document (e.g. medical certificate for sick leave). */
    documentStorageKey: varchar('document_storage_key', { length: 512 }),
    status: leaveStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    requestId: uuid('request_id').references(() => requestItems.id, { onDelete: 'set null' }),
  },
  (t) => ({
    employeeIdx: index('ix_leave_employee').on(t.employeeId, t.startDate),
    statusIdx: index('ix_leave_status').on(t.status),
  }),
);

export const overtimeEntries = workforceSchema.table(
  'overtime_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    workDate: date('work_date').notNull(),
    hours: numeric('hours', { precision: 4, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    status: overtimeStatusEnum('status').notNull().default('pending'),
    reviewerId: uuid('reviewer_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    requestId: uuid('request_id').references(() => requestItems.id, { onDelete: 'set null' }),
  },
  (t) => ({
    employeeIdx: index('ix_overtime_employee').on(t.employeeId, t.workDate),
    statusIdx: index('ix_overtime_status').on(t.status),
  }),
);

export const shiftLogs = workforceSchema.table(
  'shift_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    shiftType: shiftTypeEnum('shift_type').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    note: varchar('note', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('ix_shift_employee').on(t.employeeId, t.startsAt),
    typeIdx: index('ix_shift_type').on(t.shiftType, t.startsAt),
  }),
);
