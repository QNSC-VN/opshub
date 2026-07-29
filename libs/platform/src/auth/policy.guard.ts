import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedException, UnauthorizedException } from '../errors/exceptions';
import { AuthzService } from './authz.service';
import { ResourceScopeResolver } from './resource-scope.resolver';
import { PERMISSION_KEY, type PermissionRequirement } from './decorators';
import type { PolicyScope, ResourceAttrs } from './authz.types';
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
    private readonly scopes: ResourceScopeResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) return true;

    const req = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: unknown;
    }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('UNAUTHORIZED', 'Authentication required');

    const resource = await this.resolveScope(req, requirement.scope);
    const allowed = await this.authz.check(user.sub, requirement.permission, resource, user);
    if (!allowed) {
      throw new PermissionDeniedException(`Missing permission: ${requirement.permission}`);
    }
    return true;
  }

  /**
   * Turn the route's declarative scope into the attributes the evaluator compares
   * against. `undefined` means the route declared no scope — which is NOT the same
   * as "no constraint": AuthzService.check denies a constrained grant it cannot
   * verify.
   *
   * A descriptor whose field is absent from the request also yields `undefined`
   * rather than an empty object, so a missing `?employeeId=` cannot read as
   * "matches nothing in particular" and slip past a `self` grant.
   */
  private async resolveScope(
    req: { params: Record<string, string>; query: Record<string, unknown>; body: unknown },
    scope: PolicyScope | undefined,
  ): Promise<ResourceAttrs | undefined> {
    if (!scope) return undefined;

    const bag =
      scope.from === 'param'
        ? req.params
        : scope.from === 'query'
          ? req.query
          : ((req.body ?? {}) as Record<string, unknown>);
    const raw = bag?.[scope.field];
    const value = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    if (!value) return undefined;

    return 'resource' in scope ? this.scopes.resolve(scope.resource, value) : { [scope.as]: value };
  }
}
