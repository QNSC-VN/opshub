import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import type { Permission, RoleWithPermissions } from '@platform';
import { newId } from '@shared-kernel';
import { permissions, rolePermissions, roles } from '../../../../../../db/schema';
import type { CreateRoleInput, IRoleRepository } from '../../domain/ports/role.repository';

type RoleRow = typeof roles.$inferSelect;

@Injectable()
export class RoleDrizzleRepository implements IRoleRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  private toDomain(row: RoleRow, perms: string[]): RoleWithPermissions {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      system: row.system,
      updatedAt: row.updatedAt,
      permissions: perms,
    };
  }

  async list(): Promise<RoleWithPermissions[]> {
    const [roleRows, permRows] = await Promise.all([
      this.db.select().from(roles).orderBy(asc(roles.key)),
      this.db.select().from(rolePermissions),
    ]);
    const byRole = new Map<string, string[]>();
    for (const p of permRows) {
      const list = byRole.get(p.roleId) ?? [];
      list.push(p.permissionKey);
      byRole.set(p.roleId, list);
    }
    return roleRows.map((r) => this.toDomain(r, byRole.get(r.id) ?? []));
  }

  async findById(id: string): Promise<RoleWithPermissions | null> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!row) return null;
    return this.toDomain(row, await this.permsFor(id));
  }

  async findByKey(key: string): Promise<RoleWithPermissions | null> {
    const [row] = await this.db.select().from(roles).where(eq(roles.key, key)).limit(1);
    if (!row) return null;
    return this.toDomain(row, await this.permsFor(row.id));
  }

  private async permsFor(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.key);
  }

  async create(input: CreateRoleInput): Promise<RoleWithPermissions> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ id: newId(), key: input.key, name: input.name, system: false })
        .returning();
      if (input.permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(input.permissions.map((permissionKey) => ({ roleId: row.id, permissionKey })));
      }
      return this.toDomain(row, input.permissions);
    });
  }

  async setPermissions(roleId: string, permissionKeys: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissionKeys.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permissionKeys.map((permissionKey) => ({ roleId, permissionKey })));
      }
      await tx.update(roles).set({ updatedAt: new Date() }).where(eq(roles.id, roleId));
    });
  }

  async delete(roleId: string): Promise<void> {
    await this.db.delete(roles).where(eq(roles.id, roleId));
  }

  async listPermissions(): Promise<Permission[]> {
    return this.db.select().from(permissions).orderBy(asc(permissions.key));
  }
}
