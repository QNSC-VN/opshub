import { Inject, Injectable } from '@nestjs/common';
import {
  AuthzService,
  ConflictException,
  NotFoundException,
  PermissionDeniedException,
  ValidationException,
} from '@platform';
import type { Permission, RoleAssignment, RoleWithPermissions, ScopeType } from '@platform';
import { AuditService } from '@modules/audit';
import {
  ROLE_REPOSITORY,
  type CreateRoleInput,
  type IRoleRepository,
} from '../domain/ports/role.repository';
import {
  ROLE_ASSIGNMENT_REPOSITORY,
  type IRoleAssignmentRepository,
} from '../domain/ports/role-assignment.repository';

export interface Actor {
  sub: string;
  email: string;
}

export interface AssignRoleCommand {
  userId: string;
  roleId: string;
  scopeType?: ScopeType;
  scopeId?: string | null;
  expiresAt?: Date | null;
}

/**
 * Administrative RBAC operations: manage roles/permissions and grant/revoke
 * scoped role assignments. Every mutation writes an immutable audit record and
 * busts the affected user's permission cache so enforcement is immediate.
 */
@Injectable()
export class AuthzAdminService {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepo: IRoleRepository,
    @Inject(ROLE_ASSIGNMENT_REPOSITORY)
    private readonly assignmentRepo: IRoleAssignmentRepository,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  // ── Catalog ────────────────────────────────────────────────────────────────

  listRoles(): Promise<RoleWithPermissions[]> {
    return this.roleRepo.list();
  }

  async getRole(id: string): Promise<RoleWithPermissions> {
    const role = await this.roleRepo.findById(id);
    if (!role) throw new NotFoundException('ROLE_NOT_FOUND', `Role ${id} not found`);
    return role;
  }

  listPermissions(): Promise<Permission[]> {
    return this.roleRepo.listPermissions();
  }

  // ── Role management ──────────────────────────────────────────────────────────

  async createRole(input: CreateRoleInput, actor: Actor): Promise<RoleWithPermissions> {
    if (await this.roleRepo.findByKey(input.key)) {
      throw new ConflictException('ROLE_KEY_TAKEN', `Role key '${input.key}' already exists`);
    }
    await this.assertPermissionsExist(input.permissions);
    const role = await this.roleRepo.create(input);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.created',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { key: role.key, permissions: role.permissions },
    });
    return role;
  }

  async setRolePermissions(
    roleId: string,
    permissionKeys: string[],
    actor: Actor,
  ): Promise<RoleWithPermissions> {
    const role = await this.getRole(roleId);
    await this.assertPermissionsExist(permissionKeys);
    await this.roleRepo.setPermissions(roleId, permissionKeys);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.permissions_updated',
      resourceType: 'role',
      resourceId: roleId,
      changes: { before: role.permissions, after: permissionKeys },
    });
    // Role-definition changes propagate to holders within the cache TTL.
    return this.getRole(roleId);
  }

  async deleteRole(roleId: string, actor: Actor): Promise<void> {
    const role = await this.getRole(roleId);
    if (role.system) {
      throw new ValidationException(
        'ROLE_IMMUTABLE',
        `System role '${role.key}' cannot be deleted`,
      );
    }
    await this.roleRepo.delete(roleId);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.deleted',
      resourceType: 'role',
      resourceId: roleId,
      metadata: { key: role.key },
    });
  }

  // ── Assignments ──────────────────────────────────────────────────────────────

  listUserAssignments(userId: string): Promise<RoleAssignment[]> {
    return this.assignmentRepo.listForUser(userId);
  }

  async assignRole(command: AssignRoleCommand, actor: Actor): Promise<RoleAssignment> {
    const role = await this.roleRepo.findById(command.roleId);
    if (!role) throw new NotFoundException('ROLE_NOT_FOUND', `Role ${command.roleId} not found`);

    // Privilege-escalation guard (NIST AC-6 least privilege): an actor may only
    // grant a role whose permission set is a subset of their own. This prevents,
    // e.g., an HR/role.assign holder from granting themselves or others the
    // `admin` (`*`) role. Holders of `*` (platform admins) can grant anything.
    await this.assertCanGrantRole(actor, role);

    const scopeType = command.scopeType ?? 'global';
    const scopeId =
      scopeType === 'global' || scopeType === 'self' ? null : (command.scopeId ?? null);
    if (scopeType !== 'global' && scopeType !== 'self' && !scopeId) {
      throw new ValidationException(
        'VALIDATION_FAILED',
        `scopeId is required for scope type '${scopeType}'`,
      );
    }

    const assignment = await this.assignmentRepo.assign({
      userId: command.userId,
      roleId: command.roleId,
      scopeType,
      scopeId,
      grantedBy: actor.sub,
      expiresAt: command.expiresAt ?? null,
    });

    // Keep the JWT roles[] claim cache in sync with the RBAC source of truth,
    // then bust the permission cache so enforcement is immediate.
    await this.assignmentRepo.syncEmployeeRoleClaims(command.userId);
    await this.authz.invalidate(command.userId);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.assigned',
      resourceType: 'role_assignment',
      resourceId: assignment.id,
      metadata: {
        userId: command.userId,
        roleKey: role.key,
        scopeType,
        scopeId,
        expiresAt: assignment.expiresAt?.toISOString() ?? null,
      },
    });
    return assignment;
  }

  /**
   * Reconcile a user's GLOBAL role assignments to exactly match `roleKeys`
   * (grant missing, revoke extra), then refresh the JWT claim cache and
   * permission cache. This is the single mechanism by which external identity
   * providers (Entra App Roles) become OpsHub permissions — the assignments
   * table stays the source of truth, and `employees.roles` is derived from it.
   *
   * Unknown role keys are ignored (fail-safe: an unmapped Entra role never
   * grants access). Scoped (non-global) assignments are left untouched.
   * This bypasses the interactive escalation guard by design: it runs as the
   * system during SSO provisioning, mirroring what the IdP already asserts.
   */
  async syncUserRolesByKeys(userId: string, roleKeys: string[], actor: Actor): Promise<string[]> {
    const allRoles = await this.roleRepo.list();
    const idByKey = new Map(allRoles.map((r) => [r.key, r.id]));
    const keyById = new Map(allRoles.map((r) => [r.id, r.key]));

    const desiredRoleIds = new Set(
      roleKeys.map((k) => idByKey.get(k)).filter((id): id is string => !!id),
    );

    const current = await this.assignmentRepo.listForUser(userId);
    const currentGlobal = current.filter((a) => a.scopeType === 'global');
    const currentRoleIds = new Set(currentGlobal.map((a) => a.roleId));

    // Grant desired roles that are missing
    for (const roleId of desiredRoleIds) {
      if (!currentRoleIds.has(roleId)) {
        await this.assignmentRepo.assign({
          userId,
          roleId,
          scopeType: 'global',
          scopeId: null,
          grantedBy: actor.sub,
          expiresAt: null,
        });
      }
    }
    // Revoke global roles no longer desired
    for (const a of currentGlobal) {
      if (!desiredRoleIds.has(a.roleId)) {
        await this.assignmentRepo.revoke(a.id);
      }
    }

    const finalKeys = await this.assignmentRepo.syncEmployeeRoleClaims(userId);
    await this.authz.invalidate(userId);

    const granted = [...desiredRoleIds].map((id) => keyById.get(id)).filter(Boolean);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.synced',
      resourceType: 'employee',
      resourceId: userId,
      metadata: { requestedKeys: roleKeys, appliedRoles: granted, effectiveClaims: finalKeys },
    });
    return finalKeys;
  }

  async revokeAssignment(id: string, actor: Actor): Promise<void> {
    const assignment = await this.assignmentRepo.findById(id);
    if (!assignment) {
      throw new NotFoundException('ROLE_ASSIGNMENT_NOT_FOUND', `Assignment ${id} not found`);
    }
    await this.assignmentRepo.revoke(id);
    await this.assignmentRepo.syncEmployeeRoleClaims(assignment.userId);
    await this.authz.invalidate(assignment.userId);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'authz.role.revoked',
      resourceType: 'role_assignment',
      resourceId: id,
      metadata: { userId: assignment.userId, roleId: assignment.roleId },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Enforce no-privilege-escalation: the actor must already hold every
   * permission carried by the role they are granting. Platform admins (holders
   * of the `*` wildcard) can grant any role. Fails closed.
   */
  private async assertCanGrantRole(actor: Actor, role: RoleWithPermissions): Promise<void> {
    const effective = await this.authz.resolve(actor.sub);
    const actorPerms = new Set(Object.keys(effective));
    if (actorPerms.has('*')) return; // platform admin — may grant anything

    // Granting a role that itself carries `*` requires the actor to be `*`.
    const missing = role.permissions.filter((p) => !actorPerms.has(p));
    if (missing.length > 0) {
      throw new PermissionDeniedException(
        `Cannot grant role '${role.key}': it includes permissions you do not hold (${missing.join(', ')}).`,
      );
    }
  }

  private async assertPermissionsExist(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const catalog = new Set((await this.roleRepo.listPermissions()).map((p) => p.key));
    const unknown = keys.filter((k) => !catalog.has(k));
    if (unknown.length > 0) {
      throw new ValidationException(
        'PERMISSION_NOT_FOUND',
        `Unknown permission keys: ${unknown.join(', ')}`,
      );
    }
  }
}
