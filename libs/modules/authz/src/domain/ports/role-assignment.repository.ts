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
  findById(id: string): Promise<RoleAssignment | null>;
  /** Idempotent grant — returns the existing row when the scope already exists. */
  assign(input: AssignRoleInput): Promise<RoleAssignment>;
  revoke(id: string): Promise<void>;
  /**
   * Recompute the user's distinct active role keys from user_role_assignments
   * and write them to employees.roles (the JSONB cache used for the JWT claim).
   * Keeps the token's roles[] in sync with the RBAC source of truth.
   */
  syncEmployeeRoleClaims(userId: string): Promise<string[]>;
}
