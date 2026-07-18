/**
 * Seed script — two tiers (mirrors rally's seed architecture):
 *
 *   1. RBAC reference catalogue (permissions + roles + grants) — PROD-SAFE.
 *      Reference data the PolicyGuard and JIT SSO provisioning depend on; it
 *      must exist in EVERY environment (dev, staging AND production). Exported
 *      as `seedRbacCatalog` so db/migrate.ts runs it unconditionally. Idempotent
 *      and authoritative: descriptions/names reconcile via onConflictDoUpdate and
 *      each system role's permission set is rebuilt so catalogue edits take effect
 *      on re-run (unlike the previous onConflictDoNothing, which silently ignored
 *      edits).
 *
 *   2. Demo fixtures (login-able employees, one per system role) — DEV/E2E ONLY.
 *      Exported as `seed`, gated behind SEED_ON_DEPLOY and refused on a real
 *      production deploy. Lets `POST /v1/auth/dev-login` mint a session without
 *      hand-inserting employees. Idempotent via fixed UUIDs + onConflictDoNothing.
 *
 * Run standalone : pnpm db:seed          (catalogue + demo fixtures)
 * Called by      : db/migrate.ts — seedRbacCatalog always; seed when SEED_ON_DEPLOY=true
 */
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env in CI */
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { pgOptions } from './pg-ssl';
import { permissions, roles, rolePermissions, userRoleAssignments } from './schema/authz';
import { employees } from './schema/identity';

type SeedDb = ReturnType<typeof drizzle>;

// ── Permission catalog ────────────────────────────────────────────────────────
const PERMISSIONS: Array<{ key: string; description: string }> = [
  // Meta / RBAC
  { key: '*', description: 'Wildcard — grants every permission (admin only)' },
  { key: 'rbac.read', description: 'View roles, permissions and assignments' },
  { key: 'rbac.manage', description: 'Create / edit / delete roles and permissions' },
  { key: 'role.assign', description: 'Grant and revoke role assignments' },
  // Identity / HR
  { key: 'employee.read', description: 'View employee directory records' },
  { key: 'employee.write', description: 'Create and update employee records' },
  { key: 'employee.offboard', description: 'Trigger offboarding and revoke all access' },
  // Assets
  { key: 'asset.read', description: 'View hardware asset inventory' },
  { key: 'asset.write', description: 'Create and update asset records' },
  { key: 'asset.reassign', description: 'Reassign assets between employees' },
  // Access requests
  { key: 'access_request.read', description: 'View privileged-access requests' },
  {
    key: 'access_request.approve',
    description: 'Step-1 approval for access requests (manager tier)',
  },
  {
    key: 'access_request.security_approve',
    description: 'Step-2 IT-Security approval for access requests',
  },
  // Compliance
  { key: 'compliance.read', description: 'View compliance findings and software catalog' },
  { key: 'compliance.manage', description: 'Resolve findings and manage compliance data' },
  // Workforce
  { key: 'workforce.read', description: 'View timesheets, leave and overtime entries' },
  { key: 'workforce.approve', description: 'Approve or reject workforce requests (legacy)' },
  {
    key: 'workforce.leave.review',
    description: 'Approve or reject leave requests via the approval engine',
  },
  {
    key: 'workforce.overtime.review',
    description: 'Approve or reject overtime requests via the approval engine',
  },
  // Onboarding / Offboarding workflows
  { key: 'onboarding.approve', description: 'Step-1: Manager approves new employee hire' },
  { key: 'onboarding.provision', description: 'Step-2: IT provisions accounts and equipment' },
  { key: 'onboarding.complete', description: 'Step-3: HR marks onboarding complete' },
  {
    key: 'offboarding.approve',
    description: 'HR approves offboarding and triggers full access revocation',
  },
  // Audit
  { key: 'audit.read', description: 'Read the immutable audit log' },
  // Reports
  { key: 'reports.read', description: 'View aggregate reports and analytics dashboards' },
  // Security Posture
  { key: 'security.view', description: 'View Secure Score trends and baseline drift checks' },
  { key: 'security.manage', description: 'Trigger Graph sync and manage security posture data' },
  // Notifications
  { key: 'notifications.manage', description: 'Manage notification preferences for all users' },
  // Outbound Webhooks
  { key: 'webhooks.manage', description: 'Create and manage outbound webhook subscriptions' },
  // Service Catalog
  { key: 'catalog.manage', description: 'Create / edit / delete service catalog items' },
  // Software Licenses
  { key: 'license.read', description: 'View software licenses, seats and utilization' },
  { key: 'license.manage', description: 'Create / edit licenses and assign / revoke seats' },
];

// ── System roles → permission bundles ────────────────────────────────────────
const ROLES: Array<{ key: string; name: string; permissions: string[] }> = [
  {
    key: 'admin',
    name: 'Platform Administrator',
    permissions: ['*'],
  },
  {
    key: 'it-admin',
    name: 'IT Administrator',
    permissions: [
      'employee.read',
      'employee.write',
      'asset.read',
      'asset.write',
      'asset.reassign',
      'access_request.read',
      'access_request.approve',
      'access_request.security_approve',
      'compliance.read',
      'security.view',
      'security.manage',
      'audit.read',
      'reports.read',
      'rbac.read',
      'onboarding.provision',
      'webhooks.manage',
      'catalog.manage',
      'license.read',
      'license.manage',
    ],
  },
  {
    key: 'security',
    name: 'Security Officer',
    permissions: [
      'compliance.read',
      'compliance.manage',
      'security.view',
      'security.manage',
      'access_request.read',
      'access_request.approve',
      'access_request.security_approve',
      'audit.read',
      'reports.read',
      'license.read',
    ],
  },
  {
    key: 'hr',
    name: 'HR Manager',
    permissions: [
      'employee.read',
      'employee.write',
      'employee.offboard',
      'workforce.read',
      'workforce.approve',
      'workforce.leave.review',
      'workforce.overtime.review',
      'audit.read',
      'reports.read',
      'onboarding.approve',
      'onboarding.complete',
      'offboarding.approve',
    ],
  },
  {
    key: 'manager',
    name: 'People Manager',
    permissions: [
      'employee.read',
      'workforce.read',
      'workforce.approve',
      'workforce.leave.review',
      'workforce.overtime.review',
      'access_request.read',
      'access_request.approve',
      'reports.read',
      'onboarding.approve',
    ],
  },
  {
    key: 'helpdesk',
    name: 'Help Desk',
    permissions: ['asset.read', 'asset.write', 'access_request.read', 'employee.read'],
  },
  {
    key: 'auditor',
    name: 'Auditor (read-only)',
    permissions: [
      'rbac.read',
      'audit.read',
      'compliance.read',
      'security.view',
      'employee.read',
      'asset.read',
      'reports.read',
      'license.read',
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    permissions: [], // Base role — can submit requests and view own data.
  },
];

// ── Demo employees — one per system role, for RBAC + dev-login testing ───────
// Fixed UUIDs keep re-seeds idempotent. Each employee gets the matching legacy
// `employees.roles` jsonb (drives the JWT claims) AND a global
// `user_role_assignments` row (drives effective permissions via authz.resolve).
// Sign in locally with any of these via `POST /v1/auth/dev-login`.
const ADMIN_EMPLOYEE_ID = '00000000-0000-7000-8000-000000000001';
const DEMO_EMPLOYEES: Array<{
  id: string;
  email: string;
  displayName: string;
  roleKey: string;
}> = [
  {
    id: ADMIN_EMPLOYEE_ID,
    email: 'admin@opshub.local',
    displayName: 'Admin User',
    roleKey: 'admin',
  },
  {
    id: '00000000-0000-7000-8000-000000000002',
    email: 'it.admin@opshub.local',
    displayName: 'IT Administrator',
    roleKey: 'it-admin',
  },
  {
    id: '00000000-0000-7000-8000-000000000003',
    email: 'security@opshub.local',
    displayName: 'Security Officer',
    roleKey: 'security',
  },
  {
    id: '00000000-0000-7000-8000-000000000004',
    email: 'hr@opshub.local',
    displayName: 'HR Manager',
    roleKey: 'hr',
  },
  {
    id: '00000000-0000-7000-8000-000000000005',
    email: 'manager@opshub.local',
    displayName: 'People Manager',
    roleKey: 'manager',
  },
  {
    id: '00000000-0000-7000-8000-000000000006',
    email: 'helpdesk@opshub.local',
    displayName: 'Help Desk',
    roleKey: 'helpdesk',
  },
  {
    id: '00000000-0000-7000-8000-000000000007',
    email: 'auditor@opshub.local',
    displayName: 'Auditor',
    roleKey: 'auditor',
  },
  {
    id: '00000000-0000-7000-8000-000000000008',
    email: 'employee@opshub.local',
    displayName: 'Regular Employee',
    roleKey: 'employee',
  },
];

// ── Tier 1: RBAC reference catalogue (prod-safe) ─────────────────────────────
/**
 * Seed the permission catalogue, system roles and their permission grants.
 * PROD-SAFE reference data — no demo fixtures. Authoritative: role→permission
 * membership is rebuilt per role so removed/added grants reconcile on re-run.
 */
async function seedRbacCatalogInto(db: SeedDb): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Permission catalog — upsert so descriptions reconcile on re-run.
    await tx
      .insert(permissions)
      .values(PERMISSIONS)
      .onConflictDoUpdate({
        target: permissions.key,
        set: { description: sql`excluded.description` },
      });

    // 2. System roles — upsert so display names reconcile on re-run.
    await tx
      .insert(roles)
      .values(ROLES.map((r) => ({ key: r.key, name: r.name, system: true })))
      .onConflictDoUpdate({
        target: roles.key,
        set: { name: sql`excluded.name`, system: sql`excluded.system` },
      });

    const roleRows = await tx
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(
        inArray(
          roles.key,
          ROLES.map((r) => r.key),
        ),
      );
    const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

    // 3. Role → permission membership — rebuild each system role's grants so the
    //    join table is authoritative (edits to a role's permission list apply).
    for (const r of ROLES) {
      const roleId = roleIdByKey.get(r.key);
      if (!roleId) continue;
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (r.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(r.permissions.map((permissionKey) => ({ roleId, permissionKey })))
          .onConflictDoNothing();
      }
    }
  });

  console.log(
    `✅ RBAC catalogue seeded: ${PERMISSIONS.length} permissions | ${ROLES.length} roles`,
  );
}

/**
 * Standalone entrypoint that seeds ONLY the RBAC reference catalogue. Safe on
 * every deploy in every environment — including real production — because it
 * contains no demo fixtures. Exported so db/migrate.ts runs it unconditionally.
 */
export async function seedRbacCatalog(connectionUrl?: string): Promise<void> {
  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const db = drizzle(pool);
  try {
    await seedRbacCatalogInto(db);
  } finally {
    await pool.end();
  }
}

// ── Tier 2: demo fixtures (dev/E2E only) ─────────────────────────────────────
/**
 * Seed login-able demo employees (one per system role) plus their global role
 * assignments. DEV/E2E fixtures only. The primary admin email is overridable via
 * ADMIN_EMAIL (default admin@opshub.local).
 */
async function seedDemoEmployeesInto(db: SeedDb): Promise<void> {
  const adminEmail = process.env['ADMIN_EMAIL'] ?? 'admin@opshub.local';

  // 1. Employees — legacy roles jsonb drives the JWT claims (RolesClaimsProvider).
  await db
    .insert(employees)
    .values(
      DEMO_EMPLOYEES.map((e) => ({
        id: e.id,
        email: e.roleKey === 'admin' ? adminEmail : e.email,
        displayName: e.displayName,
        roles: [e.roleKey],
        status: 'active' as const,
      })),
    )
    .onConflictDoNothing();

  // 2. Global role assignments — drive effective permissions via authz.resolve.
  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(
      inArray(
        roles.key,
        DEMO_EMPLOYEES.map((e) => e.roleKey),
      ),
    );
  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

  for (const e of DEMO_EMPLOYEES) {
    const roleId = roleIdByKey.get(e.roleKey);
    if (!roleId) continue;
    await db
      .insert(userRoleAssignments)
      .values({
        userId: e.id,
        roleId,
        scopeType: 'global',
        grantedBy: ADMIN_EMPLOYEE_ID,
      })
      .onConflictDoNothing();
  }

  console.log(`✅ Demo employees seeded: ${DEMO_EMPLOYEES.length} (one per role)`);
}

/**
 * Full dev/E2E seed: RBAC catalogue + demo fixtures. Refused on a real production
 * deploy (NODE_ENV=production) unless SEED_ON_DEPLOY=true opts in (develop runs
 * NODE_ENV=production but seeds intentionally). Idempotent.
 */
export async function seed(connectionUrl?: string): Promise<void> {
  if (process.env['NODE_ENV'] === 'production' && process.env['SEED_ON_DEPLOY'] !== 'true') {
    throw new Error('Seed (demo fixtures) must not run in production (NODE_ENV=production).');
  }

  const url = connectionUrl ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL or connectionUrl required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const db = drizzle(pool);
  try {
    // Reference catalogue first so role assignments below resolve.
    await seedRbacCatalogInto(db);
    await seedDemoEmployeesInto(db);
  } finally {
    await pool.end();
  }
}

// Run directly: pnpm db:seed
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
}
