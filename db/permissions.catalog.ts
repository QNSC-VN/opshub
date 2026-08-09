/**
 * Canonical permission catalogue — the SINGLE source of truth for authorization.
 *
 * This file lives in `db/` (not `libs/`) on purpose: it is the one place both the
 * standalone migrator/seed image (which bundles `db/**` only) and the NestJS app
 * (via `@shared-kernel`, which re-exports it) can import. Keeping it here is what
 * stops the seed's role definitions, the backend's `@RequirePermission`
 * decorators, and the frontend's `can()` gating from drifting apart.
 *
 * Why it exists: before this, opshub had TWO permission vocabularies. `db/seed.ts`
 * defined `asset.read` / `license.read` / `audit.read` and inserted them into the
 * database, while `libs/shared-kernel/src/constants.ts` declared a `PERMISSION`
 * const holding `assets.view` / `licenses.view` / `audit.view` — codes that were
 * never seeded and that nobody could hold. Nothing referenced the constant, so it
 * was harmless in practice and loaded in principle: one autocomplete of
 * `PERMISSION.ASSETS_VIEW` would have gated a route on a permission no role
 * grants, and the route would have failed closed for everyone but `*`.
 *
 * ⚠️  Dependency-free by design — do NOT import from `libs/` here, or the
 *     migrator Docker image (which copies `db/**` only) fails to build.
 */

// ── Permission codes ─────────────────────────────────────────────────────────
//
// Convention: `<module>.<action>`, where `<module>` is the business area. The
// module is DERIVED from the code (see `moduleOf`) rather than tracked
// separately, so a new module is one line here and nothing else.
//
// Naming is `read`/`write`/`manage` + explicit verbs for state transitions
// (`approve`, `provision`, `reassign`). Keep the vocabulary boring: a reader
// should be able to guess the code for an action they have not seen yet.

export const PERMISSION = {
  // ── meta / rbac ────────────────────────────────────────────────────────────
  RBAC_READ: 'rbac.read',
  RBAC_MANAGE: 'rbac.manage',
  ROLE_ASSIGN: 'role.assign',

  // ── identity / people ──────────────────────────────────────────────────────
  EMPLOYEE_READ: 'employee.read',
  EMPLOYEE_WRITE: 'employee.write',
  EMPLOYEE_OFFBOARD: 'employee.offboard',

  // ── assets ─────────────────────────────────────────────────────────────────
  ASSET_READ: 'asset.read',
  ASSET_WRITE: 'asset.write',
  ASSET_REASSIGN: 'asset.reassign',

  // ── access requests ────────────────────────────────────────────────────────
  ACCESS_REQUEST_READ: 'access_request.read',
  /**
   * Read requests in the generic approval engine that you are not a party to.
   *
   * Without it, `GET /requests` narrows to the caller's own requests plus the ones assigned to
   * them, and a by-id read they are not a party to is refused. The `employee` tier holds no
   * codes at all, so self-service works entirely through that narrowing.
   */
  REQUEST_READ: 'request.read',
  ACCESS_REQUEST_APPROVE: 'access_request.approve',
  ACCESS_REQUEST_SECURITY_APPROVE: 'access_request.security_approve',

  // ── compliance ─────────────────────────────────────────────────────────────
  COMPLIANCE_READ: 'compliance.read',
  COMPLIANCE_MANAGE: 'compliance.manage',

  // ── workforce (timesheets, leave, overtime) ────────────────────────────────
  WORKFORCE_READ: 'workforce.read',
  /**
   * Administer the leave POLICY — the holiday calendar and annual entitlements.
   *
   * Distinct from `workforce.approve`, which decides individual requests. Setting someone's
   * allowance or declaring a public holiday changes what every future request costs, so it is a
   * different act with a different blast radius, and an approver should not automatically hold it.
   */
  WORKFORCE_MANAGE: 'workforce.manage',
  WORKFORCE_APPROVE: 'workforce.approve',
  WORKFORCE_LEAVE_REVIEW: 'workforce.leave.review',
  WORKFORCE_OVERTIME_REVIEW: 'workforce.overtime.review',

  // ── onboarding / offboarding workflows ─────────────────────────────────────
  ONBOARDING_APPROVE: 'onboarding.approve',
  ONBOARDING_PROVISION: 'onboarding.provision',
  ONBOARDING_COMPLETE: 'onboarding.complete',
  OFFBOARDING_APPROVE: 'offboarding.approve',

  // ── audit ──────────────────────────────────────────────────────────────────
  AUDIT_READ: 'audit.read',

  // ── reports ────────────────────────────────────────────────────────────────
  REPORTS_READ: 'reports.read',

  // ── security posture ───────────────────────────────────────────────────────
  SECURITY_VIEW: 'security.view',
  SECURITY_MANAGE: 'security.manage',

  // ── notifications ──────────────────────────────────────────────────────────
  NOTIFICATIONS_MANAGE: 'notifications.manage',

  // ── outbound webhooks ──────────────────────────────────────────────────────
  WEBHOOKS_MANAGE: 'webhooks.manage',

  // ── service catalog ────────────────────────────────────────────────────────
  CATALOG_MANAGE: 'catalog.manage',

  // ── software licences ──────────────────────────────────────────────────────
  LICENSE_READ: 'license.read',
  LICENSE_MANAGE: 'license.manage',
} as const;

/** Union of every valid permission code. A typo is a compile error. */
export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/**
 * Super-admin grant. Held only by the `admin` role and checked before anything
 * else, so it needs no entry in {@link PERMISSION} — it is not a capability, it
 * is the absence of a limit.
 */
export const WILDCARD_PERMISSION = '*';

/** Human-readable purpose per code. Seeded into `authz.permissions.description`. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [PERMISSION.RBAC_READ]: 'View roles, permissions and assignments',
  [PERMISSION.RBAC_MANAGE]: 'Create / edit / delete roles and permissions',
  [PERMISSION.ROLE_ASSIGN]: 'Grant and revoke role assignments',
  [PERMISSION.EMPLOYEE_READ]: 'View employee directory records',
  [PERMISSION.EMPLOYEE_WRITE]: 'Create and update employee records',
  [PERMISSION.EMPLOYEE_OFFBOARD]: 'Trigger offboarding and revoke all access',
  [PERMISSION.ASSET_READ]: 'View hardware asset inventory',
  [PERMISSION.ASSET_WRITE]: 'Create and update asset records',
  [PERMISSION.ASSET_REASSIGN]: 'Reassign assets between employees',
  [PERMISSION.ACCESS_REQUEST_READ]: 'View privileged-access requests',
  [PERMISSION.REQUEST_READ]: 'View requests you are not the requester or approver of',
  [PERMISSION.ACCESS_REQUEST_APPROVE]: 'Step-1 approval for access requests (manager tier)',
  [PERMISSION.ACCESS_REQUEST_SECURITY_APPROVE]: 'Step-2 IT-Security approval for access requests',
  [PERMISSION.COMPLIANCE_READ]: 'View compliance findings and software catalog',
  [PERMISSION.COMPLIANCE_MANAGE]: 'Resolve findings and manage compliance data',
  [PERMISSION.WORKFORCE_READ]: 'View timesheets, leave and overtime entries',
  [PERMISSION.WORKFORCE_MANAGE]: 'Manage the holiday calendar and annual leave entitlements',
  [PERMISSION.WORKFORCE_APPROVE]: 'Approve or reject workforce requests (legacy)',
  [PERMISSION.WORKFORCE_LEAVE_REVIEW]: 'Approve or reject leave requests via the approval engine',
  [PERMISSION.WORKFORCE_OVERTIME_REVIEW]:
    'Approve or reject overtime requests via the approval engine',
  [PERMISSION.ONBOARDING_APPROVE]: 'Step-1: Manager approves new employee hire',
  [PERMISSION.ONBOARDING_PROVISION]: 'Step-2: IT provisions accounts and equipment',
  [PERMISSION.ONBOARDING_COMPLETE]: 'Step-3: HR marks onboarding complete',
  [PERMISSION.OFFBOARDING_APPROVE]: 'HR approves offboarding and triggers full access revocation',
  [PERMISSION.AUDIT_READ]: 'Read the immutable audit log',
  [PERMISSION.REPORTS_READ]: 'View aggregate reports and analytics dashboards',
  [PERMISSION.SECURITY_VIEW]: 'View Secure Score trends and baseline drift checks',
  [PERMISSION.SECURITY_MANAGE]: 'Trigger Graph sync and manage security posture data',
  [PERMISSION.NOTIFICATIONS_MANAGE]: 'Manage notification preferences for all users',
  [PERMISSION.WEBHOOKS_MANAGE]: 'Create and manage outbound webhook subscriptions',
  [PERMISSION.CATALOG_MANAGE]: 'Create / edit / delete service catalog items',
  [PERMISSION.LICENSE_READ]: 'View software licenses, seats and utilization',
  [PERMISSION.LICENSE_MANAGE]: 'Create / edit licenses and assign / revoke seats',
};

/**
 * The module a code belongs to — its first segment. Derived rather than declared
 * so adding a module cannot forget to register it, and so a rename of the prefix
 * cannot leave a stale mapping behind.
 *
 * `workforce.leave.review` → `workforce`, i.e. the module is the FIRST segment,
 * not everything before the last dot. Sub-namespaces belong to their module.
 */
export function moduleOf(permission: string): string {
  return permission.split('.')[0] ?? permission;
}

/** Every module present in the catalogue, sorted. Useful for grouping a UI. */
export function permissionModules(): string[] {
  return [...new Set(Object.values(PERMISSION).map(moduleOf))].sort();
}

/**
 * The ONE wildcard-aware permission check, so the semantics cannot drift between
 * the guard, the services and the frontend. A holder of `held` is granted
 * `required` when any of these is true:
 *
 *   - `*`        — the super-admin grant
 *   - exact code — `asset.read` grants `asset.read`
 *   - `<module>.*` — a module-wide grant, e.g. `asset.*` grants `asset.reassign`
 *
 * The module wildcard is deliberately supported before any role uses one: an
 * internal platform grows by module, and "owns everything in Assets" is the grant
 * a real org hands out. Supporting it here means a future role bundle is a data
 * change, not a code change. Deny by default.
 */
export function permissionGrants(held: readonly string[] | undefined, required: string): boolean {
  if (!held?.length) return false;
  if (held.includes(WILDCARD_PERMISSION) || held.includes(required)) return true;
  return held.includes(`${moduleOf(required)}.*`);
}

// ── Roles ────────────────────────────────────────────────────────────────────

export const ROLE = {
  ADMIN: 'admin',
  IT_ADMIN: 'it-admin',
  SECURITY: 'security',
  HR: 'hr',
  MANAGER: 'manager',
  HELPDESK: 'helpdesk',
  AUDITOR: 'auditor',
  EMPLOYEE: 'employee',
} as const;

/** Union of every valid system-role key. */
export type RoleKey = (typeof ROLE)[keyof typeof ROLE];

export const ROLE_NAMES: Record<RoleKey, string> = {
  [ROLE.ADMIN]: 'Platform Administrator',
  [ROLE.IT_ADMIN]: 'IT Administrator',
  [ROLE.SECURITY]: 'Security Officer',
  [ROLE.HR]: 'HR Manager',
  [ROLE.MANAGER]: 'People Manager',
  [ROLE.HELPDESK]: 'Help Desk',
  [ROLE.AUDITOR]: 'Auditor (read-only)',
  [ROLE.EMPLOYEE]: 'Employee',
};

/**
 * Role → permission bundles, seeded into `authz.role_permissions`.
 *
 * `admin` holds only the wildcard, deliberately: enumerating every code for it
 * would need editing here on every new permission, and a missed edit would make
 * the platform administrator quietly less privileged than intended.
 *
 * `employee` holds nothing. Every user gets it, and self-service access (submit a
 * request, read your own records) is expressed by the `self` SCOPE on a grant,
 * not by a permission code — so an empty bundle here is correct, not a stub.
 */
export const ROLE_PERMISSIONS: Record<
  RoleKey,
  readonly (Permission | typeof WILDCARD_PERMISSION)[]
> = {
  [ROLE.ADMIN]: [WILDCARD_PERMISSION],

  [ROLE.IT_ADMIN]: [
    PERMISSION.EMPLOYEE_READ,
    PERMISSION.EMPLOYEE_WRITE,
    PERMISSION.ASSET_READ,
    PERMISSION.ASSET_WRITE,
    PERMISSION.ASSET_REASSIGN,
    PERMISSION.ACCESS_REQUEST_READ,
    PERMISSION.REQUEST_READ,
    PERMISSION.ACCESS_REQUEST_APPROVE,
    PERMISSION.ACCESS_REQUEST_SECURITY_APPROVE,
    PERMISSION.COMPLIANCE_READ,
    PERMISSION.SECURITY_VIEW,
    PERMISSION.SECURITY_MANAGE,
    PERMISSION.AUDIT_READ,
    PERMISSION.REPORTS_READ,
    PERMISSION.RBAC_READ,
    PERMISSION.ONBOARDING_PROVISION,
    PERMISSION.WEBHOOKS_MANAGE,
    PERMISSION.CATALOG_MANAGE,
    PERMISSION.LICENSE_READ,
    PERMISSION.LICENSE_MANAGE,
  ],

  [ROLE.SECURITY]: [
    PERMISSION.COMPLIANCE_READ,
    PERMISSION.COMPLIANCE_MANAGE,
    PERMISSION.SECURITY_VIEW,
    PERMISSION.SECURITY_MANAGE,
    PERMISSION.ACCESS_REQUEST_READ,
    PERMISSION.ACCESS_REQUEST_APPROVE,
    PERMISSION.ACCESS_REQUEST_SECURITY_APPROVE,
    PERMISSION.REQUEST_READ,
    PERMISSION.AUDIT_READ,
    PERMISSION.REPORTS_READ,
    PERMISSION.LICENSE_READ,
  ],

  [ROLE.HR]: [
    PERMISSION.EMPLOYEE_READ,
    PERMISSION.EMPLOYEE_WRITE,
    PERMISSION.EMPLOYEE_OFFBOARD,
    PERMISSION.WORKFORCE_READ,
    PERMISSION.WORKFORCE_APPROVE,
    PERMISSION.WORKFORCE_LEAVE_REVIEW,
    PERMISSION.WORKFORCE_OVERTIME_REVIEW,
    PERMISSION.WORKFORCE_MANAGE,
    PERMISSION.REQUEST_READ,
    PERMISSION.AUDIT_READ,
    PERMISSION.REPORTS_READ,
    PERMISSION.ONBOARDING_APPROVE,
    PERMISSION.ONBOARDING_COMPLETE,
    PERMISSION.OFFBOARDING_APPROVE,
  ],

  [ROLE.MANAGER]: [
    PERMISSION.EMPLOYEE_READ,
    PERMISSION.WORKFORCE_READ,
    PERMISSION.WORKFORCE_APPROVE,
    PERMISSION.WORKFORCE_LEAVE_REVIEW,
    PERMISSION.WORKFORCE_OVERTIME_REVIEW,
    PERMISSION.ACCESS_REQUEST_READ,
    PERMISSION.ACCESS_REQUEST_APPROVE,
    PERMISSION.REQUEST_READ,
    PERMISSION.REPORTS_READ,
    PERMISSION.ONBOARDING_APPROVE,
  ],

  [ROLE.HELPDESK]: [
    PERMISSION.ASSET_READ,
    PERMISSION.ASSET_WRITE,
    PERMISSION.ACCESS_REQUEST_READ,
    PERMISSION.REQUEST_READ,
    PERMISSION.EMPLOYEE_READ,
  ],

  [ROLE.AUDITOR]: [
    PERMISSION.RBAC_READ,
    PERMISSION.AUDIT_READ,
    PERMISSION.COMPLIANCE_READ,
    PERMISSION.SECURITY_VIEW,
    PERMISSION.EMPLOYEE_READ,
    PERMISSION.ASSET_READ,
    PERMISSION.REQUEST_READ,
    PERMISSION.REPORTS_READ,
    PERMISSION.LICENSE_READ,
  ],

  [ROLE.EMPLOYEE]: [],
};
