import { describe, expect, it, vi } from 'vitest';
import { AuthzService } from './authz.service';
import { ScopeEvaluator } from './scope-evaluator';
import type { EffectivePermissions, JwtPayload } from './authz.types';

/**
 * Scope enforcement, and specifically the case that used to be wrong.
 *
 * `check()` read `if (!resource) return true`, and no route in the codebase passed
 * a resource — so every CONSTRAINED grant (`self`/`team`/`dept`/`region`) was
 * enforced as if it were `global`. The RBAC API accepts and stores those scopes, so
 * an operator could grant "asset.write @ dept=QA" and the holder could write every
 * department's assets. The scope was recorded and ignored.
 *
 * These tests pin the corrected rule: a global grant decides on its own; a
 * constrained grant with nothing to check against DENIES.
 */

function serviceWith(effective: EffectivePermissions) {
  const cache = {
    getJson: vi.fn().mockResolvedValue(effective),
    setJson: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  };
  // The DB is never reached: the cache always hits.
  const db = {} as never;
  const service = new AuthzService(db, cache as never, new ScopeEvaluator());
  return { service, cache };
}

const actor = { sub: 'user-1' } as unknown as JwtPayload;

describe('AuthzService.check', () => {
  it('denies when the permission is not held at all', async () => {
    const { service } = serviceWith({ 'asset.read': [{ type: 'global', id: null }] });
    expect(await service.check('user-1', 'asset.write')).toBe(false);
  });

  it('allows a global grant with no resource to check', async () => {
    const { service } = serviceWith({ 'asset.write': [{ type: 'global', id: null }] });
    expect(await service.check('user-1', 'asset.write')).toBe(true);
  });

  it('DENIES a constrained grant when the route declares no scope', async () => {
    // The regression this file exists for. Before the fix this returned true and
    // the dept limit did nothing.
    const { service } = serviceWith({ 'asset.write': [{ type: 'dept', id: 'QA' }] });
    expect(await service.check('user-1', 'asset.write', undefined, actor)).toBe(false);
  });

  it('denies a constrained grant when the principal is missing', async () => {
    // `self` is meaningless without someone to be, so this cannot be allowed either.
    const { service } = serviceWith({ 'asset.write': [{ type: 'self', id: null }] });
    expect(await service.check('user-1', 'asset.write', { ownerId: 'user-1' })).toBe(false);
  });

  it('allows a self grant on the caller’s own resource', async () => {
    const { service } = serviceWith({ 'workforce.read': [{ type: 'self', id: null }] });
    expect(await service.check('user-1', 'workforce.read', { ownerId: 'user-1' }, actor)).toBe(
      true,
    );
  });

  it('denies a self grant on someone else’s resource', async () => {
    const { service } = serviceWith({ 'workforce.read': [{ type: 'self', id: null }] });
    expect(await service.check('user-1', 'workforce.read', { ownerId: 'user-2' }, actor)).toBe(
      false,
    );
  });

  it('matches a dept grant against the resource’s department name', async () => {
    // `scope_id` holds the department NAME, because employees.department is a
    // varchar and there is no departments table to key against.
    const { service } = serviceWith({ 'employee.read': [{ type: 'dept', id: 'QA' }] });
    expect(await service.check('user-1', 'employee.read', { deptId: 'QA' }, actor)).toBe(true);
    expect(await service.check('user-1', 'employee.read', { deptId: 'Finance' }, actor)).toBe(
      false,
    );
  });

  it('lets a global grant win even when a narrower one is also held', async () => {
    // Scopes are additive: holding both must not be more restrictive than holding
    // only the broad one.
    const { service } = serviceWith({
      'asset.write': [
        { type: 'dept', id: 'QA' },
        { type: 'global', id: null },
      ],
    });
    expect(await service.check('user-1', 'asset.write', undefined, actor)).toBe(true);
  });

  it('honours a module wildcard, and keeps its scope', async () => {
    // `asset.*` covers `asset.write`; the scope on that grant still applies.
    const { service } = serviceWith({ 'asset.*': [{ type: 'self', id: null }] });
    expect(await service.check('user-1', 'asset.write', { ownerId: 'user-1' }, actor)).toBe(true);
    expect(await service.check('user-1', 'asset.write', { ownerId: 'user-2' }, actor)).toBe(false);
  });

  it('lets the super-admin wildcard through regardless of scope shape', async () => {
    const { service } = serviceWith({ '*': [{ type: 'global', id: null }] });
    expect(await service.check('user-1', 'security.manage')).toBe(true);
  });
});
