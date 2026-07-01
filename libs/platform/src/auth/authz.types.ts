/**
 * Authorization domain types shared by the enforcement layer (PolicyGuard,
 * AuthzService, ScopeEvaluator) and the authz management module.
 */
import type { JwtPayload } from './jwt.strategy';

/** Scope dimensions a role assignment can be constrained to. */
export type ScopeType = 'global' | 'self' | 'team' | 'dept' | 'region';

/** A concrete scope grant attached to an effective permission. */
export interface Scope {
  type: ScopeType;
  /** Identifier of the team/dept/region; null for global/self. */
  id: string | null;
}

/**
 * Attributes of the resource a guarded route acts on, used to evaluate scoped
 * grants. Populated by a route's `scopeFrom` resolver; omit for unscoped routes.
 */
export interface ResourceAttrs {
  ownerId?: string;
  teamId?: string;
  deptId?: string;
  region?: string;
}

/** permissionKey → scopes in which the principal holds it. */
export type EffectivePermissions = Record<string, Scope[]>;

/** Wildcard permission key — grants every permission within its scope. */
export const WILDCARD_PERMISSION = '*';

export interface Permission {
  key: string;
  description: string;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  system: boolean;
  updatedAt: Date;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}

export interface RoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId: string | null;
  grantedBy: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Re-export for guard/decorator consumers that resolve the principal. */
export type { JwtPayload };
