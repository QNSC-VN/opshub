/**
 * Production seed — bootstraps the RBAC catalog (permissions + system roles)
 * and a representative set of employee accounts for every role.
 *
 * Design goals:
 *  - Idempotent: safe to run multiple times on a live DB (ON CONFLICT DO NOTHING
 *    / existence checks).
 *  - Complete: every system role has at least one user so devs can test all
 *    permission boundaries without manual setup.
 *  - Consistent: the `roles` JSONB column on employees (used in JWT claims)
 *    always matches the RBAC table entries.
 *
 * Run with:  tsx --env-file=.env db/seed.ts
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Pool } from 'pg';
import { employees } from './schema/identity';
import { pgOptions } from './pg-ssl';
import { permissions, roles, rolePermissions, userRoleAssignments } from './schema/authz';

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

// ── Representative employees (one per role) ───────────────────────────────────
// roleKeys populates BOTH the JSONB `roles` column (JWT claims) AND the RBAC
// user_role_assignments table — they must stay in sync.
const EMPLOYEES: Array<{
  email: string;
  displayName: string;
  department: string;
  jobTitle: string;
  roleKeys: string[];
  status: 'active' | 'on_leave' | 'offboarded';
}> = [
  {
    email: 'admin@opshub.local',
    displayName: 'Platform Admin',
    department: 'IT Operations',
    jobTitle: 'Platform Administrator',
    roleKeys: ['admin'],
    status: 'active',
  },
  {
    email: 'it.admin@opshub.local',
    displayName: 'IT Admin',
    department: 'IT Operations',
    jobTitle: 'IT Systems Administrator',
    roleKeys: ['it-admin'],
    status: 'active',
  },
  {
    email: 'security@opshub.local',
    displayName: 'Security Officer',
    department: 'Information Security',
    jobTitle: 'Information Security Officer',
    roleKeys: ['security'],
    status: 'active',
  },
  {
    email: 'hr@opshub.local',
    displayName: 'HR Manager',
    department: 'Human Resources',
    jobTitle: 'HR Manager',
    roleKeys: ['hr'],
    status: 'active',
  },
  {
    email: 'manager@opshub.local',
    displayName: 'People Manager',
    department: 'Engineering',
    jobTitle: 'Engineering Manager',
    roleKeys: ['manager'],
    status: 'active',
  },
  {
    email: 'helpdesk@opshub.local',
    displayName: 'Help Desk Agent',
    department: 'IT Operations',
    jobTitle: 'IT Support Specialist',
    roleKeys: ['helpdesk'],
    status: 'active',
  },
  {
    email: 'auditor@opshub.local',
    displayName: 'Internal Auditor',
    department: 'Compliance',
    jobTitle: 'Internal Auditor',
    roleKeys: ['auditor'],
    status: 'active',
  },
  {
    email: 'alice@opshub.local',
    displayName: 'Alice Johnson',
    department: 'Engineering',
    jobTitle: 'Software Engineer',
    roleKeys: ['employee'],
    status: 'active',
  },
  {
    email: 'bob@opshub.local',
    displayName: 'Bob Smith',
    department: 'Sales',
    jobTitle: 'Account Executive',
    roleKeys: ['employee'],
    status: 'active',
  },
  {
    email: 'carol@opshub.local',
    displayName: 'Carol White',
    department: 'Finance',
    jobTitle: 'Financial Analyst',
    roleKeys: ['employee'],
    status: 'active',
  },
];

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL env var is required');

  const pool = new Pool({ ...pgOptions(url), max: 1 });
  const db = drizzle(pool);

  // 1. Permission catalog
  await db.insert(permissions).values(PERMISSIONS).onConflictDoNothing({ target: permissions.key });

  // 2. System roles
  await db
    .insert(roles)
    .values(ROLES.map((r) => ({ key: r.key, name: r.name, system: true })))
    .onConflictDoNothing({ target: roles.key });

  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(
      inArray(
        roles.key,
        ROLES.map((r) => r.key),
      ),
    );
  const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

  // 3. Role → permission membership
  const rolePermValues = ROLES.flatMap((r) => {
    const roleId = roleIdByKey.get(r.key);
    if (!roleId) return [];
    return r.permissions.map((permissionKey) => ({ roleId, permissionKey }));
  });
  if (rolePermValues.length > 0) {
    await db
      .insert(rolePermissions)
      .values(rolePermValues)
      .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionKey] });
  }

  // 4. Employees (with JSONB roles for JWT claims)
  await db
    .insert(employees)
    .values(
      EMPLOYEES.map((e) => ({
        email: e.email,
        displayName: e.displayName,
        department: e.department,
        jobTitle: e.jobTitle,
        roles: e.roleKeys,
        status: e.status,
      })),
    )
    .onConflictDoNothing({ target: employees.email });

  const empRows = await db
    .select({ id: employees.id, email: employees.email })
    .from(employees)
    .where(
      inArray(
        employees.email,
        EMPLOYEES.map((e) => e.email),
      ),
    );
  const empIdByEmail = new Map(empRows.map((e) => [e.email, e.id]));

  const adminId = empIdByEmail.get('admin@opshub.local');

  // 5. RBAC user_role_assignments (global scope, idempotent)
  for (const emp of EMPLOYEES) {
    const userId = empIdByEmail.get(emp.email);
    if (!userId) continue;

    for (const roleKey of emp.roleKeys) {
      const roleId = roleIdByKey.get(roleKey);
      if (!roleId) continue;

      const [existing] = await db
        .select({ id: userRoleAssignments.id })
        .from(userRoleAssignments)
        .where(
          and(
            eq(userRoleAssignments.userId, userId),
            eq(userRoleAssignments.roleId, roleId),
            eq(userRoleAssignments.scopeType, 'global'),
            isNull(userRoleAssignments.scopeId),
          ),
        )
        .limit(1);
      if (existing) continue;

      await db.insert(userRoleAssignments).values({
        userId,
        roleId,
        scopeType: 'global',
        scopeId: null,
        grantedBy: adminId ?? userId,
      });
    }
  }

  console.log(
    `✅ Seeded: ${PERMISSIONS.length} permissions | ${ROLES.length} roles | ${EMPLOYEES.length} employees`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
