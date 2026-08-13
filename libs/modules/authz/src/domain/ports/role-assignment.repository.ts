import type { DbExecutor } from '@platform';
import type { RoleAssignment, ScopeType } from '@platform';

export const ROLE_ASSIGNMENT_REPOSITORY = Symbol('ROLE_ASSIGNMENT_REPOSITORY');

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  grantedBy: string;
  expiresAt: Date | null;
}

export interface IRoleAssignmentRepository {
  listForUser(userId: string): Promise<RoleAssignment[]>;
  /**
   * Distinct users holding this role, in any scope. Needed because a change to a
   * ROLE's definition changes what every holder can do, and each holder's resolved
   * permissions are cached per user — so the write path has to know whose cache to
   * drop.
   */
  listUserIdsForRole(roleId: string): Promise<string[]>;
  findById(id: string): Promise<RoleAssignment | null>;
  /** Idempotent grant — returns the existing row when the scope already exists. */
  assign(input: AssignRoleInput, tx?: DbExecutor): Promise<RoleAssignment>;
  revoke(id: string, tx?: DbExecutor): Promise<void>;
  /**
   * Recompute the user's distinct active role keys from user_role_assignments
   * and write them to employees.roles (the JSONB cache used for the JWT claim).
   * Keeps the token's roles[] in sync with the RBAC source of truth.
   */
  syncEmployeeRoleClaims(userId: string): Promise<string[]>;
}
