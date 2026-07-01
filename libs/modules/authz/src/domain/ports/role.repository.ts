import type { Permission, RoleWithPermissions } from '@platform';

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

export interface CreateRoleInput {
  key: string;
  name: string;
  permissions: string[];
}

export interface IRoleRepository {
  list(): Promise<RoleWithPermissions[]>;
  findById(id: string): Promise<RoleWithPermissions | null>;
  findByKey(key: string): Promise<RoleWithPermissions | null>;
  create(input: CreateRoleInput): Promise<RoleWithPermissions>;
  /** Replace a role's permission set atomically. */
  setPermissions(roleId: string, permissionKeys: string[]): Promise<void>;
  delete(roleId: string): Promise<void>;
  /** Full permission catalog. */
  listPermissions(): Promise<Permission[]>;
}
