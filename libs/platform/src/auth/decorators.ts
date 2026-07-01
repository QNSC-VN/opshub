import {
  SetMetadata,
  applyDecorators,
  UseGuards,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt.guard';
import { RoleGuard } from './role.guard';
import { PolicyGuard } from './policy.guard';
import type { JwtPayload } from './jwt.strategy';
import type { ResourceAttrs } from './authz.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'requiredRoles';
export const PERMISSION_KEY = 'requiredPermission';

/** Resolves the acted-upon resource's attributes from the request, for scoped checks. */
export type ScopeResolver = (req: unknown) => ResourceAttrs | Promise<ResourceAttrs>;

/** Metadata attached by @RequirePermission and read by the PolicyGuard. */
export interface PermissionRequirement {
  permission: string;
  scopeFrom?: ScopeResolver;
}

/** Mark a route as unauthenticated (skip JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Require the principal to hold at least one of the given roles. */
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

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

/** Apply JWT auth + role guard + Swagger bearer annotation in one decorator. */
export const Auth = (...roles: string[]) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, RoleGuard),
    ApiBearerAuth('access-token'),
    ...(roles.length ? [RequireRoles(...roles)] : []),
  );

/**
 * Require a fine-grained permission (resource.action), enforced by the
 * PolicyGuard against the principal's cached effective permissions. Pass
 * `scopeFrom` to additionally constrain by resource scope (team/dept/region/self).
 */
export const RequirePermission = (permission: string, scopeFrom?: ScopeResolver) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PolicyGuard),
    SetMetadata(PERMISSION_KEY, { permission, scopeFrom } satisfies PermissionRequirement),
    ApiBearerAuth('access-token'),
  );
