import {
  SetMetadata,
  applyDecorators,
  UseGuards,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt.guard';
import { PolicyGuard } from './policy.guard';
import type { JwtPayload } from './jwt.strategy';
import type { PolicyScope } from './authz.types';
import type { Permission } from '@shared-kernel';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSION_KEY = 'requiredPermission';

/** Metadata attached by @RequirePermission and read by the PolicyGuard. */
export interface PermissionRequirement {
  /**
   * Typed against the catalogue, so `'assset.read'` is a compile error rather
   * than a route that fails closed for everyone in production.
   */
  permission: Permission;
  /**
   * Declarative, so every route's scope can be read and audited without running
   * anything. Omit it for a route whose permission is not resource-scoped.
   */
  scope?: PolicyScope;
}

/** Mark a route as unauthenticated (skip JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Extract the authenticated principal from the request.
 * Only use on routes protected by @Auth() or JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  return ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user;
});

// ── Swagger error-response shortcuts ────────────────────────────────────────

type HttpErrorCode = 400 | 401 | 403 | 404 | 409 | 412 | 422 | 429;

const HTTP_ERROR_DESCRIPTIONS: Record<HttpErrorCode, string> = {
  400: 'Bad Request — validation error or malformed input',
  401: 'Unauthorized — missing or invalid authentication',
  403: 'Forbidden — insufficient permissions',
  404: 'Not Found',
  409: 'Conflict — duplicate record or state conflict',
  412: 'Precondition Failed',
  422: 'Unprocessable — business rule violation',
  429: 'Too Many Requests — rate limit exceeded',
};

export const ApiCommonErrors = (...codes: HttpErrorCode[]) =>
  applyDecorators(
    ...codes.map((c) => ApiResponse({ status: c, description: HTTP_ERROR_DESCRIPTIONS[c] })),
  );

/**
 * Authentication ONLY: verify the caller and annotate Swagger. It carries no
 * authorization — a route under `@Auth()` alone is open to every authenticated
 * caller, which is correct only for surfaces that are self-scoped by construction
 * (`/me`, notification preferences) or that run around a session existing.
 *
 * For anything else use `@RequirePermission(...)`, which mounts the `PolicyGuard`.
 * `@Auth()` used to also mount a `RoleGuard` and accept role names; that guard
 * authorized from the JWT `roles` claim — a mint-time snapshot, so a revoked role
 * stayed effective until the token rotated, and it sat beside the DB-resolved
 * permission path as a second, disagreeing source of truth. Both are gone.
 */
export const Auth = () => applyDecorators(UseGuards(JwtAuthGuard), ApiBearerAuth('access-token'));

/**
 * Require a fine-grained permission (`module.action`), enforced by the PolicyGuard
 * against the principal's DB-resolved effective permissions.
 *
 * `scope` declares WHICH resource the route acts on, so a grant limited to
 * `self`/`dept` can be checked against it:
 *
 *   // the request already carries the owning employee
 *   @RequirePermission('workforce.read', { from: 'query', field: 'employeeId', as: 'ownerId' })
 *
 *   // the request carries the resource id; load it to find its owner
 *   @RequirePermission('asset.write', { resource: 'asset', from: 'param', field: 'id' })
 *
 * Omit `scope` only where the permission genuinely is not resource-scoped (listing
 * the role catalogue, reading global reports). A holder of a `self`- or
 * `dept`-scoped grant is DENIED on a route with no scope, because the constraint
 * cannot be verified there — see AuthzService.check.
 *
 * This replaced a `scopeFrom: (req) => ResourceAttrs` callback that no route ever
 * used: a per-route closure is strictly more powerful and cannot be listed,
 * reviewed in bulk, or checked by a test, which is the opposite of what an
 * authorization surface needs.
 */
export const RequirePermission = (permission: Permission, scope?: PolicyScope) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PolicyGuard),
    SetMetadata(PERMISSION_KEY, { permission, scope } satisfies PermissionRequirement),
    ApiBearerAuth('access-token'),
  );
