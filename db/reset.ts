/**
 * Truncate the operational tables so the demo-fixture seed lands on a known database.
 *
 * Why this exists. Nothing in the e2e suite tears down what it creates — every `afterAll`
 * closes the Nest app and cleans nothing — while the specs insert timesheets, leave and
 * requests on every pass. So a developer's database grows forever, and two things follow,
 * both of which rally hit for real before this pattern was adopted there:
 *
 *   • Tests read each other's leftovers. A list assertion that holds on a clean database
 *     becomes order- or count-dependent once fifty rows from earlier runs exist, and the
 *     failure surfaces in an unrelated file.
 *   • Unique keys collide with the seed's own fixed ids. The seed uses
 *     `onConflictDoNothing`, which is safe against a re-run but NOT against a database
 *     something else has written to — and it reports nothing, so the fixture is simply
 *     absent and whatever depended on it fails somewhere else entirely.
 *
 * Truncate rather than per-test teardown: teardown means unwinding foreign keys in the right
 * order in every file that creates anything, which is exactly the discipline that never
 * holds. One `TRUNCATE ... CASCADE` at the start of the run is a single place to be correct.
 *
 * NOT wired into `pnpm db:migrate` or `seed()`. Only the explicit e2e global setup calls it.
 * Truncating a deployed database because a migration ran would be catastrophic, and a shared
 * helper is exactly what invites that, so the gate is that `seed()` never calls this itself.
 */
import { Pool } from 'pg';
import { pgOptions } from './pg-ssl';
import { resolveMigrationUrl } from './database-url';

/**
 * Every table holding operational data, listed EXPLICITLY.
 *
 * `TRUNCATE ... CASCADE` follows the foreign keys itself, which is the point — hand-ordering
 * a safe delete across 28 tables is the discipline that never holds. Explicit rather than
 * discovered from `information_schema`: a new table nobody adds here keeps its rows, which
 * is a visible bug, where auto-discovery would silently wipe a table someone meant to keep.
 *
 * Deliberately absent — `identity.*` and `authz.*`:
 *
 *   • `identity.employees` IS the fixture set. The e2e specs authenticate as those rows
 *     (`employee@opshub.local`, `hr@opshub.local`), so truncating them removes the very
 *     thing the suite logs in as.
 *   • `authz.*` holds the permission catalogue, the system roles, their grants and the
 *     `user_role_assignments` that make `hr` an unconstrained `workforce.read` holder.
 *     Dropping a role takes its assignments with it, and the tier fixtures stop meaning
 *     anything.
 *
 * Both are reconciled idempotently by `seedRbacCatalog` / `seed`, so they need no reset.
 */
export const FIXTURE_TABLES = [
  // workforce — what the isolation suite creates on every run
  'workforce.timesheets',
  'workforce.leave_requests',
  'workforce.overtime_entries',
  'workforce.shift_logs',
  'workforce.attendance_logs',
  /**
   * The leave CALENDAR and ALLOWANCES, not just the requests.
   *
   * `leave-balance.e2e.spec.ts` picks a year from a 40-year window to avoid colliding with another
   * run, then declares holidays in it. Left untruncated those rows accumulate: 24 holidays across
   * 12 distinct years had piled up in a local database, so roughly one run in three already drew an
   * occupied year, `uq_holiday_date_region` or the extra rows changed the day count, and a spec
   * asserting arithmetic failed for reasons nothing in it could explain. The odds got worse with
   * every run — which is what a growing database does to a suite that samples for uniqueness.
   */
  'workforce.holidays',
  'workforce.leave_entitlements',
  // requests — the approval engine's rows, written by every workflow spec
  'requests.request_approvals',
  'requests.request_comments',
  'requests.request_items',
  // access requests and the grants they produce
  'access.access_grants',
  'access.access_requests',
  // assets and their assignment history
  'assets.asset_assignments',
  'assets.assets',
  // service catalogue, compliance, licences, posture
  'catalog.catalog_items',
  'compliance.compliance_findings',
  'compliance.software_catalog',
  'licenses.license_assignments',
  'licenses.software_licenses',
  'security_posture.baseline_checks',
  'security_posture.secure_score_snapshots',
  // outboxes and delivery state — a stale row here makes a relay spec see another's work
  'messaging.notification_outbox',
  'messaging.email_outbox',
  'messaging.webhook_deliveries',
  'messaging.webhook_subscriptions',
  'notifications.in_app_notifications',
  'notifications.notification_preferences',
  // controlled documents — versions and acknowledgements follow the parent via CASCADE
  'documents.document_acknowledgements',
  'documents.document_versions',
  'documents.documents',
  /**
   * positions — BOTH tables, and `employee_positions` matters most.
   *
   * Left out, an employee keeps the open assignment a previous run gave them, and the next run's
   * first transfer is dated BEFORE it and refused as `POSITION_INVALID_WINDOW`. That is a suite
   * which passes exactly once per database, and it fails ten tests in with a status that looks
   * like a product bug rather than a stale row. Measured, not predicted.
   */
  'positions.employee_positions',
  'positions.positions',
  // employment contracts — `uq_employee_active_contract` is per employee, so one left active by a
  // previous run makes the next run's first activation a 409 that names a contract nobody wrote.
  'contracts.employment_contracts',
  // training — `uq_training_record_current` is per (employee, course), so a record left current by a
  // previous run makes the next run's first completion for that pair a 409 nobody wrote.
  'training.records',
  'training.position_requirements',
  'training.courses',
  // ISMS — `uq_risk_reference` is global, and a risk left `accepted` by a previous run makes the
  // next run's acceptance a 412 nobody wrote. Treatments cascade from risks, listed for intent.
  'isms.risk_treatments',
  'isms.risks',
  // The attachment link rows. `storage.stored_files` is truncated below and CASCADEs into this
  // table, but listing it explicitly keeps the intent visible rather than incidental.
  'storage.attachments',
  // audit trail and uploaded file metadata
  'audit.audit_logs',
  'storage.stored_files',
] as const;

/** Truncate every fixture table. Takes a URL rather than a pool so callers need no setup. */
export async function resetFixtureTables(connectionUrl?: string): Promise<void> {
  // Prefers DATABASE_MIGRATION_URL: TRUNCATE is DDL-adjacent and the least-privilege
  // application role is not guaranteed to hold it.
  const url = connectionUrl ?? resolveMigrationUrl();

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  try {
    await pool.query(`TRUNCATE TABLE ${FIXTURE_TABLES.join(', ')} CASCADE`);
  } finally {
    await pool.end();
  }
}
