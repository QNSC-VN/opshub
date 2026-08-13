import type { RequestItemResponse } from '@/shared/api/types';

/**
 * The request rules this screen has to agree with, mirrored from `RequestEngineService`.
 *
 * WHY THEY ARE HERE AND NOT INLINE IN JSX. Both are read in more than one place — the row actions, the
 * drawer header — and both are claims ABOUT THE SERVER that are wrong if the server changes. A rule written
 * twice inside a `cell` callback is a rule that can disagree with itself, and one buried in a ternary cannot
 * be tested without rendering a page.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. The engine enforces all of it; this only decides whether to offer an
 * action that would otherwise come back as a 403 or a 412 the user can do nothing about.
 */

/**
 * The statuses a request is still OPEN in — awaiting a decision.
 *
 * `cancel` refuses anything else with `REQUEST_NOT_CANCELLABLE`, and it is the same pair approve and reject
 * key off, because it is the same fact: the request has not been resolved yet.
 */
export const OPEN_STATUSES: readonly string[] = ['pending', 'in_review'];

export function isOpen(status: string): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * Whether to offer WITHDRAWING a request.
 *
 * THE REQUESTER, OR A HOLDER OF `rbac.manage` — the engine's own test, and not a guess: `cancel` throws
 * `PermissionDeniedException('Only the requester can cancel their own request')` for anybody else. An
 * approver looking at somebody else's request has REJECT; withdrawing is the requester taking back the
 * asking, which is a different act and deliberately not available to the person deciding it.
 *
 * `meSub` is undefined while `/me` is in flight. It returns false then rather than guessing — an action that
 * flickers into existence is worse than one that appears a moment late, and the admin case is the one that
 * would flicker.
 */
export function canCancelRequest(
  request: Pick<RequestItemResponse, 'status' | 'requesterId'>,
  meSub: string | undefined,
  canManage: boolean,
): boolean {
  if (!isOpen(request.status)) return false;
  return (!!meSub && request.requesterId === meSub) || canManage;
}
