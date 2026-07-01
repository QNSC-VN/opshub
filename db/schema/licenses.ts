/**
 * licenses schema — software/SaaS license inventory and seat assignments.
 */
import { pgSchema, uuid, varchar, integer, date, timestamp, index, text } from 'drizzle-orm/pg-core';
import { licenseTypeEnum, licenseStatusEnum } from './enums';

export const licensesSchema = pgSchema('licenses');

export const softwareLicenses = licensesSchema.table(
  'software_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull(),
    vendor: varchar('vendor', { length: 120 }).notNull(),
    licenseType: licenseTypeEnum('license_type').notNull().default('subscription'),
    /** Total seats purchased. Null means unlimited (e.g. site license). */
    seatCount: integer('seat_count'),
    /** Monthly cost per seat in USD cents (e.g. 1500 = $15.00). Null = included. */
    costPerSeatCents: integer('cost_per_seat_cents'),
    renewalDate: date('renewal_date'),
    status: licenseStatusEnum('status').notNull().default('active'),
    notes: text('notes'),
    /** External contract / vendor ID for reference. */
    externalId: varchar('external_id', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index('ix_sl_name').on(t.name),
    statusIdx: index('ix_sl_status').on(t.status),
    renewalIdx: index('ix_sl_renewal').on(t.renewalDate),
  }),
);

export const licenseAssignments = licensesSchema.table(
  'license_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    licenseId: uuid('license_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    notes: varchar('notes', { length: 500 }),
  },
  (t) => ({
    licenseIdx: index('ix_la_license').on(t.licenseId, t.assignedAt),
    employeeIdx: index('ix_la_employee').on(t.employeeId),
  }),
);
