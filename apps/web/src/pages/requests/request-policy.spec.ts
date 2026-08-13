import { describe, expect, it } from 'vitest';
import { canCancelRequest, isOpen } from './request-policy';

/**
 * The withdraw rule, mirrored from `RequestEngineService.cancel`.
 *
 * WHY THIS IS A UNIT TEST AND NOT ONLY A BROWSER ONE. Every Playwright seat is a seeded admin holding the
 * `'*'` wildcard, so `rbac.manage` is always true there and the browser suite CANNOT tell the requester
 * branch from the admin branch — both render the same button. The distinction is the whole rule: an approver
 * looking at somebody else's request rejects it, and withdrawing is the requester taking back the asking.
 */

const OPEN = { status: 'pending', requesterId: 'emp-1' };

describe('canCancelRequest', () => {
  it('offers it to the requester', () => {
    expect(canCancelRequest(OPEN, 'emp-1', false)).toBe(true);
  });

  it('withholds it from anybody else without rbac.manage', () => {
    // The engine answers this caller "Only the requester can cancel their own request", so the button would
    // be a 403 with a decision the person cannot make. They have Reject instead.
    expect(canCancelRequest(OPEN, 'emp-2', false)).toBe(false);
  });

  it('offers it to a holder of rbac.manage on somebody else’s request', () => {
    expect(canCancelRequest(OPEN, 'emp-2', true)).toBe(true);
  });

  it('withholds it once the request is resolved, for anybody', () => {
    // `REQUEST_NOT_CANCELLABLE`. The status gate comes FIRST, so even the requester and even an admin get
    // nothing — which is why this asserts both rather than only the interesting one.
    for (const status of ['approved', 'rejected', 'cancelled', 'expired']) {
      expect(canCancelRequest({ status, requesterId: 'emp-1' }, 'emp-1', true)).toBe(false);
    }
  });

  it('offers nothing while /me is still in flight', () => {
    // `meSub` undefined. Returning false rather than guessing keeps the button from flickering into
    // existence a moment after the drawer opens.
    expect(canCancelRequest(OPEN, undefined, false)).toBe(false);
  });

  it('still offers it to an admin before /me resolves, because that branch does not need the id', () => {
    expect(canCancelRequest(OPEN, undefined, true)).toBe(true);
  });
});

describe('isOpen', () => {
  it('is the two statuses that are awaiting a decision, and nothing else', () => {
    expect(isOpen('pending')).toBe(true);
    expect(isOpen('in_review')).toBe(true);
    for (const status of ['approved', 'rejected', 'cancelled', 'expired']) {
      expect(isOpen(status)).toBe(false);
    }
  });
});
