/**
 * Grant LOGIN to the least-privilege Postgres roles, then PROVE they are not
 * over-privileged. This is step 2 of docs/runbooks/db-role-least-privilege.md.
 *
 * Migration 0012 creates `opshub_app` and `opshub_worker` NOLOGIN, because giving a
 * role a password is a deliberate cutover step, not something a migration should do
 * on every deploy. This script is that step, and it runs in two places:
 *
 *  - CI, before the e2e job, so the whole suite connects as `opshub_app` instead of
 *    the owner. Without that the split is untested: every other job connects as an
 *    owner, so a table or sequence migration 0012 forgot to GRANT would pass CI and
 *    surface only after the real cutover, as `permission denied for …` on a route
 *    nobody associated with a database migration.
 *
 *  - The deployed environments, as a one-off ECS task on the MIGRATOR task
 *    definition — the only workload holding the RDS master credential and sitting in
 *    the database's subnets. RDS is not publicly accessible and ECS Exec is off, so
 *    there is no other path in:
 *      aws ecs run-task --task-definition opshub-<env>-migrator \
 *        --overrides '{"containerOverrides":[{"name":"migrator",
 *          "command":["node","dist/db/enable-least-privilege-roles.js"]}]}'
 *
 * Idempotent: ALTER ROLE sets the password to whatever value it is given, so a
 * re-run with the same secret is a no-op, and it is safe to run before the infra
 * flag flip — the roles simply sit unused until something connects as them.
 *
 * Lives in db/ rather than a scripts/ directory so it compiles into dist/db via
 * tsconfig.migrator.json and ships in the migrator image, and so it reuses this
 * repo's DSN composition instead of re-deriving it.
 */
// Load .env for local dev; in CI and ECS the env vars are injected directly.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI or container mode */
}

import { Client } from 'pg';
import { pgOptions } from './pg-ssl';
import { resolveMigrationUrl } from './database-url';

interface Target {
  role: string;
  /** Env var holding this role's password. Absent = skip the role entirely. */
  passwordEnv: string;
}

/**
 * The roles this script knows how to enable, and where each password comes from.
 *
 * A role whose password env var is unset is SKIPPED, not defaulted. That is what lets
 * one script serve both callers: CI supplies only `opshub_app` (the e2e suite is its
 * only consumer), while the deployed one-off task supplies both from the
 * `db-app-password` / `db-worker-password` secrets. Defaulting instead would mean a
 * typo in the secret wiring silently set a guessable password on a real role.
 */
const TARGETS: Target[] = [
  { role: 'opshub_app', passwordEnv: 'DATABASE_APP_PASSWORD' },
  { role: 'opshub_worker', passwordEnv: 'DATABASE_WORKER_PASSWORD' },
];

/**
 * Attributes that must all be false on a least-privilege role. `rolsuper` and
 * `rolbypassrls` are the ones that would make the whole split decorative —
 * bypassrls in particular, since the point of moving off the owner is to stop
 * Postgres exempting it from row-level security.
 */
const FORBIDDEN_ATTRIBUTES = [
  'rolsuper',
  'rolbypassrls',
  'rolcreatedb',
  'rolcreaterole',
  'rolreplication',
] as const;

/**
 * A schema the DDL probe can attempt to write in. Any application schema works; this
 * one is picked because it exists in every environment from migration 0001.
 */
const PROBE_SCHEMA = 'workforce';

/**
 * Application schemas whose every table the runtime roles must be able to read and
 * write. Kept in step with the `app_schemas` array in migration 0012 — if the two
 * disagree, {@link assertEveryTableReachable} reports the tables the migration missed.
 */
const APP_SCHEMAS = [
  'identity',
  'authz',
  'access',
  'assets',
  'audit',
  'catalog',
  'compliance',
  'licenses',
  'messaging',
  'notifications',
  'requests',
  'security_posture',
  'storage',
  'workforce',
] as const;

const DML_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

/**
 * Assert the role can perform all four DML operations on EVERY table in the
 * application schemas.
 *
 * The DDL probe below samples one table; this is exhaustive, and it is the check that
 * actually protects the cutover. A table the migration's grants missed — one added by a
 * later migration in a schema nobody remembered to add to `app_schemas`, say — is
 * invisible until a request touches it, and then it is a 500 in production on a code
 * path that has nothing obviously to do with a database migration. Running the e2e
 * suite as this role catches only the tables the suite happens to touch.
 *
 * `has_table_privilege` resolves inherited grants and role membership, so this answers
 * the real question — can this role do it — rather than inspecting grant rows.
 */
async function assertEveryTableReachable(admin: Client, role: string): Promise<void> {
  const { rows } = await admin.query<{ tbl: string; missing: string }>(
    `SELECT t.table_schema || '.' || t.table_name AS tbl,
            string_agg(p.priv, ', ' ORDER BY p.priv) AS missing
       FROM information_schema.tables t
       CROSS JOIN unnest($2::text[]) AS p(priv)
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema = ANY($3::text[])
        AND NOT has_table_privilege($1, t.table_schema || '.' || t.table_name, p.priv)
      GROUP BY 1
      ORDER BY 1`,
    [role, [...DML_PRIVILEGES], [...APP_SCHEMAS]],
  );

  if (rows.length > 0) {
    throw new Error(
      `${role} is missing privileges on ${rows.length} table(s), so it would fail at ` +
        `runtime on any request touching them:\n` +
        rows.map((r) => `    ${r.tbl} — missing ${r.missing}`).join('\n') +
        `\n\nAdd the schema to app_schemas in ` +
        `db/migrations/0012_app_role_least_privilege.sql (and to APP_SCHEMAS here), or ` +
        `grant the table explicitly in the migration that created it.`,
    );
  }

  console.log(
    `    ${role}: all four DML privileges on every table in ${APP_SCHEMAS.length} schemas.`,
  );
}

/**
 * `ALTER ROLE` is utility DDL: the grammar accepts neither an identifier nor a
 * password as a bind parameter, so both have to be interpolated. Validate them
 * instead. This runs against REAL databases, not just an ephemeral CI one, so an
 * unchecked interpolation here would be an injection sink with production reach.
 */
function assertSafeRole(role: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`Refusing to interpolate an unsafe role name: ${role}`);
  }
}

function assertSafePassword(role: string, passwordEnv: string, password: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(password)) {
    throw new Error(
      `${passwordEnv} must be [A-Za-z0-9_-] only (it is the password for ${role}). ` +
        'database-url.ts composes a DSN from parts and percent-encodes them, but ' +
        'restricting the charset sidesteps encoding questions entirely — see the runbook.',
    );
  }
  if (password.length < 24) {
    throw new Error(
      `${passwordEnv} is ${password.length} characters. Use at least 24 — this is a ` +
        'credential for a role with write access to every application table.',
    );
  }
}

/** Enable one role and verify it. Throws on anything unexpected. */
async function enableRole(
  adminUrl: string,
  admin: Client,
  target: Target,
  password: string,
): Promise<void> {
  const { role } = target;
  assertSafeRole(role);
  assertSafePassword(role, target.passwordEnv, password);

  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (exists.rows.length === 0) {
    throw new Error(
      `Role ${role} does not exist. Migration 0012 should have created it — ` +
        'has db:migrate run against this database?',
    );
  }

  await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);

  // Assert the role gained LOGIN and nothing else. A role that is superuser or
  // bypasses RLS is WORSE than the master credential it replaces, because it looks
  // restricted.
  const attrs = await admin.query<Record<string, boolean>>(
    `SELECT rolcanlogin, ${FORBIDDEN_ATTRIBUTES.join(', ')} FROM pg_roles WHERE rolname = $1`,
    [role],
  );
  const row = attrs.rows[0];
  if (!row?.['rolcanlogin']) {
    throw new Error(`${role} still cannot log in after ALTER ROLE. Nothing else was changed.`);
  }
  const granted = FORBIDDEN_ATTRIBUTES.filter((a) => row[a]);
  if (granted.length > 0) {
    throw new Error(
      `${role} holds privileged attributes it must not have: ${granted.join(', ')}. ` +
        'Fix the role before pointing any workload at it.',
    );
  }

  await assertEveryTableReachable(admin, role);

  // Two probes as the role itself. The positive one matters as much as the negative:
  // a role that cannot run DDL *because it cannot do anything* would pass the check
  // below and then fail every request after cutover.
  const roleUrl = new URL(adminUrl);
  roleUrl.username = role;
  roleUrl.password = password;

  const client = new Client(pgOptions(roleUrl.toString()));
  await client.connect();
  try {
    // Positive: the grants from 0012 actually reached this role.
    await client.query(`SELECT 1 FROM ${PROBE_SCHEMA}.timesheets LIMIT 1`);

    // Negative: DML rights only. Wrapped in a transaction that ALWAYS rolls back, so
    // a failure part-way cannot leave a stray probe table in a real schema.
    let ddlAllowed = false;
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TABLE ${PROBE_SCHEMA}.privilege_probe (id int)`);
      ddlAllowed = true;
    } catch {
      // Expected: permission denied. DML-only is the whole point of the role.
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }

    if (ddlAllowed) {
      throw new Error(
        `${role} was able to CREATE TABLE. It must hold DML rights only — check the ` +
          'GRANTs in db/migrations/0012_app_role_least_privilege.sql.',
      );
    }
  } finally {
    await client.end();
  }

  console.log(
    `✅  ${role}: can log in, can read its tables, holds no privileged attributes, cannot run DDL.`,
  );
}

async function run(): Promise<void> {
  // Resolves DATABASE_MIGRATION_URL, else DATABASE_URL, else composes from the
  // DATABASE_* parts — the deployed path, where the migrator's master credential
  // arrives straight from the RDS-managed secret.
  let adminUrl: string;
  try {
    adminUrl = resolveMigrationUrl();
  } catch (err) {
    console.error(`❌  ${(err as Error).message}`);
    process.exit(1);
  }

  const requested = TARGETS.map((t) => ({
    target: t,
    password: process.env[t.passwordEnv],
  })).filter((r): r is { target: Target; password: string } => Boolean(r.password));

  if (requested.length === 0) {
    console.error(
      '❌  No role passwords supplied. Set at least one of: ' +
        `${TARGETS.map((t) => t.passwordEnv).join(', ')}.`,
    );
    process.exit(1);
  }

  const admin = new Client(pgOptions(adminUrl));
  await admin.connect();
  try {
    for (const { target, password } of requested) {
      await enableRole(adminUrl, admin, target, password);
    }
  } catch (err) {
    console.error(`❌  ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await admin.end();
  }
}

void run();
