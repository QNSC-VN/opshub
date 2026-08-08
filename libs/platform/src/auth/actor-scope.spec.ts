/**
 * ActorScope — the two narrowing primitives shared by workforce, the request engine and
 * access requests.
 *
 * `workforce-access-narrowing.spec.ts` covers `narrowFilter` heavily through the caller that
 * originated it, and `request-visibility.e2e.spec.ts` covers both over HTTP. What is left, and
 * what these tests are for, is the behaviour that is easy to get wrong and invisible at those
 * levels: the null handling in `assertParty`, and the fact that a mismatched filter DENIES
 * rather than being quietly rewritten.
 */
import { describe, expect, it, vi } from 'vitest';
import { PermissionDeniedException } from '../errors/exceptions';
import { ActorScope } from './actor-scope.service';
import type { AuthzService } from './authz.service';

const ACTOR = { sub: 'user-1' };

/**
 * The shape a real caller passes: the owner field is DECLARED and optional, which is what lets
 * `field: keyof T & string` stay type-checked while the value may be absent. An inline literal
 * without the key is rejected by the compiler — correctly, and this alias is why that
 * constraint is worth keeping rather than widening `field` to `string`.
 */
type Filters = { employeeId?: string; status?: string };

function scopeWith(holdsPermission: boolean) {
  const check = vi.fn().mockResolvedValue(holdsPermission);
  return { scope: new ActorScope({ check } as unknown as AuthzService), check };
}

describe('ActorScope.narrowFilter', () => {
  it('returns the filters untouched for a permission holder', async () => {
    const { scope } = scopeWith(true);
    const filters: Filters = { employeeId: 'someone-else', status: 'pending' };

    await expect(scope.narrowFilter(filters, 'employeeId', ACTOR, 'workforce.read')).resolves.toBe(
      filters,
    );
  });

  it('pins an ABSENT owner filter to the actor', async () => {
    const { scope } = scopeWith(false);

    // The leak this exists to close: an absent filter must not mean "no constraint".
    const noOwner: Filters = { status: 'pending' };
    await expect(
      scope.narrowFilter(noOwner, 'employeeId', ACTOR, 'workforce.read'),
    ).resolves.toEqual({ status: 'pending', employeeId: 'user-1' });
  });

  it('allows the actor to filter on themselves', async () => {
    const { scope } = scopeWith(false);

    const own: Filters = { employeeId: 'user-1' };
    await expect(scope.narrowFilter(own, 'employeeId', ACTOR, 'workforce.read')).resolves.toEqual({
      employeeId: 'user-1',
    });
  });

  it('DENIES a filter naming someone else rather than silently narrowing it', async () => {
    const { scope } = scopeWith(false);

    // Silent narrowing would return a plausible page of the wrong person's data, which the
    // caller cannot tell apart from "that person has no records".
    const someoneElse: Filters = { employeeId: 'user-2' };
    await expect(
      scope.narrowFilter(someoneElse, 'employeeId', ACTOR, 'workforce.read'),
    ).rejects.toThrow(PermissionDeniedException);
  });
});

describe('ActorScope.assertParty', () => {
  it('allows a party without consulting the permission', async () => {
    const { scope, check } = scopeWith(false);

    await expect(
      scope.assertParty(['user-1', null], ACTOR, 'request.read', 'request'),
    ).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('allows a non-party who holds the permission', async () => {
    const { scope } = scopeWith(true);

    await expect(
      scope.assertParty(['someone-else'], ACTOR, 'request.read', 'request'),
    ).resolves.toBeUndefined();
  });

  it('denies a non-party without the permission', async () => {
    const { scope } = scopeWith(false);

    await expect(
      scope.assertParty(['someone-else'], ACTOR, 'request.read', 'request'),
    ).rejects.toThrow(/not a party to this request/);
  });

  it('does not treat a null party as a match', async () => {
    // The subtle one. `parties: [requesterId, assigneeId]` on an UNASSIGNED row passes a null,
    // and a `some(id => id === actor.sub)` written without the null guard would still be false
    // here — but an implementation comparing `undefined === undefined` would admit everyone.
    const { scope } = scopeWith(false);

    await expect(
      scope.assertParty(
        [null, undefined],
        { sub: undefined as unknown as string },
        'request.read',
        'request',
      ),
    ).rejects.toThrow(PermissionDeniedException);
  });
});
