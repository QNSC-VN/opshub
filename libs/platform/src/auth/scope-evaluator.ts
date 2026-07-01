import { Injectable } from '@nestjs/common';
import type { JwtPayload, ResourceAttrs, Scope, ScopeType } from './authz.types';

/**
 * Pure, stateless strategy matcher: does any granted scope cover the resource?
 *
 * Each scope type maps to a predicate comparing the grant against the resource
 * attributes (and the acting principal for `self`). Kept dependency-free so it
 * is trivially unit-testable and cheap to call on the hot request path.
 */
@Injectable()
export class ScopeEvaluator {
  private readonly matchers: Record<
    ScopeType,
    (grant: Scope, resource: ResourceAttrs, user: JwtPayload) => boolean
  > = {
    global: () => true,
    self: (_grant, resource, user) => resource.ownerId === user.sub,
    team: (grant, resource) => grant.id != null && grant.id === resource.teamId,
    dept: (grant, resource) => grant.id != null && grant.id === resource.deptId,
    region: (grant, resource) => grant.id != null && grant.id === resource.region,
  };

  /** True if at least one granted scope authorizes acting on the resource. */
  anyMatches(grants: Scope[], resource: ResourceAttrs, user: JwtPayload): boolean {
    return grants.some((g) => this.matchers[g.type](g, resource, user));
  }
}
