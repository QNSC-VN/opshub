import { Injectable } from '@nestjs/common';
import type { Permission } from '@shared-kernel';
import { PermissionDeniedException } from '../errors/exceptions';
import { AuthzService } from './authz.service';

/** The authenticated principal, as every service in this codebase receives it. */
interface Actor {
  sub: string;
}

/**
 * The two ways a route narrows data to the caller when its permission is OPTIONAL.
 *
 * WHY THIS EXISTS AS A SERVICE
 * ----------------------------
 * `WorkforceService` worked this out first (`narrowToActor` / `assertOwnerOrApprover`) and got
 * the hard part right, including the non-obvious rule below about denying instead of narrowing.
 * The request engine and the access-request module needed exactly the same two primitives, and
 * three copies of an authorization rule is three chances for one of them to drift into a leak
 * — which is how the engine came to have no check at all.
 *
 * THE RULE THAT IS EASY TO GET WRONG: asking for someone else's records without the permission
 * is DENIED, not silently narrowed to your own. Silent narrowing returns a plausible page of
 * the wrong person's data, which to the caller is indistinguishable from "that person has no
 * records" — a worse answer than a 403, and one that hides the authorization boundary from the
 * client entirely.
 */
@Injectable()
export class ActorScope {
  constructor(private readonly authz: AuthzService) {}

  /**
   * Narrow a LIST filter to the actor unless they hold `permission`.
   *
   * For routes whose owner filter is optional — the shape that caused the leak this class was
   * extracted to fix. `RequestEngine.list` built its WHERE clause from optional filters only,
   * so an unfiltered call returned every row in the table; the actor id was used for nothing
   * but the `myQueue` shortcut.
   *
   * @param field The filter key holding the owner id (`employeeId`, `requesterId`, …).
   */
  async narrowFilter<T extends object, K extends keyof T & string>(
    filters: T,
    field: K,
    actor: Actor,
    permission: Permission,
  ): Promise<T> {
    if (await this.authz.check(actor.sub, permission)) return filters;

    // `T extends object` rather than `Record<string, unknown>` so a declared filter interface
    // (`AccessRequestFilters`, `TimesheetFilters`) satisfies it without an index signature.
    const requested = (filters as Record<string, unknown>)[field];
    if (typeof requested === 'string' && requested !== actor.sub) {
      throw new PermissionDeniedException(
        `Missing permission: ${permission} — you may only list your own records`,
      );
    }
    return { ...filters, [field]: actor.sub };
  }

  /**
   * Assert the actor is a party to a record, or holds `permission`.
   *
   * For BY-ID routes, where there is no filter to narrow: the row is already identified, so the
   * only question is whether this caller may see it. `parties` takes several ids because being
   * a party is rarely just ownership — a request's approver is as entitled to read it as its
   * requester, and passing both is clearer than a chain of `||`.
   *
   * `null`/`undefined` entries are ignored rather than treated as a match, so an unassigned row
   * cannot be read by everyone: `parties: [requesterId, assigneeId]` with a null assignee must
   * not admit a caller whose own id is also absent.
   */
  async assertParty(
    parties: readonly (string | null | undefined)[],
    actor: Actor,
    permission: Permission,
    what: string,
  ): Promise<void> {
    if (parties.some((id) => id != null && id === actor.sub)) return;
    if (await this.authz.check(actor.sub, permission)) return;
    throw new PermissionDeniedException(
      `Missing permission: ${permission} — you are not a party to this ${what}`,
    );
  }
}
