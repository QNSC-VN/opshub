import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedException } from '../errors/exceptions';
import { ROLES_KEY } from './decorators';
import { ROLE } from '@shared-kernel';
import type { JwtPayload } from './jwt.strategy';

/**
 * Role guard — enforces that the authenticated principal has at least one of the
 * roles declared via @Auth('role') / @RequireRoles(...). No roles required → allow.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    const roles = user?.roles ?? [];
    // admin role has wildcard permissions — bypass all role restrictions.
    if (roles.includes(ROLE.ADMIN)) return true;
    if (required.some((r) => roles.includes(r))) return true;

    throw new PermissionDeniedException(`Requires one of roles: ${required.join(', ')}`);
  }
}
