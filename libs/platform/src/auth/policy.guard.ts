import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedException, UnauthorizedException } from '../errors/exceptions';
import { AuthzService } from './authz.service';
import { PERMISSION_KEY, type PermissionRequirement } from './decorators';
import type { JwtPayload } from './jwt.strategy';

/**
 * Permission guard — enforces the fine-grained permission declared via
 * @RequirePermission(...). Runs after JwtAuthGuard, so request.user is set.
 *
 * No requirement metadata → allow (route relies on @Auth / @Public). Resolution
 * is delegated to {@link AuthzService}, which fails closed on cache/DB errors.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED', 'Authentication required');

    const resource = requirement.scopeFrom ? await requirement.scopeFrom(req) : undefined;
    const allowed = await this.authz.check(user.sub, requirement.permission, resource, user);
    if (!allowed) {
      throw new PermissionDeniedException(`Missing permission: ${requirement.permission}`);
    }
    return true;
  }
}
