import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '../database/drizzle.provider';
import { CacheService } from '@qnsc-vn/platform-cache';
import { rolePermissions, userRoleAssignments } from '../../../../db/schema';
import { ScopeEvaluator } from './scope-evaluator';
import { permissionGrants } from '@shared-kernel';
import {
  type EffectivePermissions,
  type JwtPayload,
  type ResourceAttrs,
  type Scope,
} from './authz.types';

/**
 * Resolves and caches a principal's effective permissions, and answers
 * permission checks for the PolicyGuard.
 *
 * Resolution is a single indexed join (assignments ⋈ role_permissions) filtered
 * to non-expired grants, cached in Valkey under a per-user key with a bounded
 * TTL. The cache is shared across replicas, so {@link invalidate} busts every
 * instance at once; the TTL is the safety net for role-definition edits.
 *
 * Fail-closed: any resolution error denies access (returns empty permissions).
 */
@Injectable()
export class AuthzService {
  private readonly logger = new Logger(AuthzService.name);
  private static readonly CACHE_TTL_SECONDS = 300;
  private static readonly CACHE_PREFIX = 'authz:perms:';

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly cache: CacheService,
    private readonly scopes: ScopeEvaluator,
  ) {}

  private cacheKey(userId: string): string {
    return `${AuthzService.CACHE_PREFIX}${userId}`;
  }

  /** Effective permissions for a user (cached). Empty map on any failure. */
  async resolve(userId: string): Promise<EffectivePermissions> {
    const key = this.cacheKey(userId);
    const cached = await this.cache.getJson<EffectivePermissions>(key);
    if (cached) return cached;

    try {
      const rows = await this.db
        .select({
          permissionKey: rolePermissions.permissionKey,
          scopeType: userRoleAssignments.scopeType,
          scopeId: userRoleAssignments.scopeId,
        })
        .from(userRoleAssignments)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoleAssignments.roleId))
        .where(
          and(
            eq(userRoleAssignments.userId, userId),
            or(
              isNull(userRoleAssignments.expiresAt),
              gt(userRoleAssignments.expiresAt, new Date()),
            ),
          ),
        );

      const effective: EffectivePermissions = {};
      for (const row of rows) {
        const scope: Scope = { type: row.scopeType, id: row.scopeId };
        (effective[row.permissionKey] ??= []).push(scope);
      }

      await this.cache.setJson(key, effective, AuthzService.CACHE_TTL_SECONDS);
      return effective;
    } catch (err) {
      // Fail closed — never grant access when resolution fails.
      this.logger.error({ err, userId }, 'Permission resolution failed — denying');
      return {};
    }
  }

  /** Drop a user's cached permissions after a role/assignment change. */
  async invalidate(userId: string): Promise<void> {
    await this.cache.del(this.cacheKey(userId));
  }

  /**
   * Does the principal hold `permission`? When `resource` is provided, the grant
   * must also cover it via {@link ScopeEvaluator}; otherwise holding the
   * permission in any scope suffices. Wildcard (`*`) grants short-circuit.
   */
  async check(
    userId: string,
    permission: string,
    resource?: ResourceAttrs,
    user?: JwtPayload,
  ): Promise<boolean> {
    const effective = await this.resolve(userId);

    // Which of the holder's codes cover `permission` is decided by the catalogue's
    // `permissionGrants` — the same function the frontend gating and the seed use —
    // rather than re-implemented here. Previously this checked only `*` and an
    // exact match, so a module-wide grant (`asset.*`) would have been silently
    // ignored by the guard while the UI showed the capability as held.
    const grants = Object.entries(effective)
      .filter(([code]) => permissionGrants([code], permission))
      .flatMap(([, scopes]) => scopes);
    if (grants.length === 0) return false;
    if (!resource || !user) return true;
    return this.scopes.anyMatches(grants, resource, user);
  }
}
