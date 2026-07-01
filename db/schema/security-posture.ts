/**
 * security_posture schema — Microsoft Secure Score snapshots + baseline drift checks.
 */
import { pgSchema, uuid, varchar, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';

export const securityPostureSchema = pgSchema('security_posture');

/**
 * Daily Secure Score snapshots pulled from Graph /security/secureScores.
 * Retained for 90-day trend analysis.
 */
export const secureScoreSnapshots = securityPostureSchema.table(
  'secure_score_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Points scored (e.g. 234.5) */
    score: numeric('score', { precision: 8, scale: 2 }).notNull(),
    /** Maximum achievable points */
    maxScore: numeric('max_score', { precision: 8, scale: 2 }).notNull(),
    /** score / maxScore * 100 — pre-computed for fast trend queries */
    percentageScore: numeric('percentage_score', { precision: 5, scale: 2 }).notNull(),
    /** ISO date string from Graph (e.g. "2025-06-27") */
    scoreDate: varchar('score_date', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index('ix_secure_score_date').on(t.scoreDate),
  }),
);

/**
 * Baseline drift checks — one row per check per device per sync cycle.
 * Covers ASR rules, firewall profiles, encryption, and GPO settings.
 */
export const baselineChecks = securityPostureSchema.table(
  'baseline_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** e.g. 'asr' | 'firewall' | 'encryption' | 'gpo' */
    category: varchar('category', { length: 40 }).notNull(),
    /** Human-readable rule name, e.g. "Block Office macros from child processes" */
    checkName: varchar('check_name', { length: 300 }).notNull(),
    /** 'pass' | 'fail' | 'warning' | 'not_applicable' */
    status: varchar('status', { length: 20 }).notNull().default('not_applicable'),
    /** Intune managed-device ID (null = tenant-level check) */
    deviceId: varchar('device_id', { length: 64 }),
    deviceName: varchar('device_name', { length: 200 }),
    /** Expected value vs observed value, stringified */
    expectedValue: varchar('expected_value', { length: 200 }),
    actualValue: varchar('actual_value', { length: 200 }),
    details: text('details'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryStatusIdx: index('ix_baseline_category_status').on(t.category, t.status),
    deviceIdx: index('ix_baseline_device').on(t.deviceId),
    checkedAtIdx: index('ix_baseline_checked_at').on(t.checkedAt),
  }),
);
