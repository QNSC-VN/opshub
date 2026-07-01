/**
 * OffboardingTypeDef.onApprove() unit tests.
 *
 * Tests that the 5 cleanup operations (employee status, role assignments,
 * access grants, asset assignments + asset status reset, refresh token
 * revocation) are all called with the correct table arguments.
 *
 * Tables are identified by object identity (imported singleton references),
 * not by name introspection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OffboardingTypeDef } from './offboarding.type-def';
import {
  employees,
  userRoleAssignments,
  accessGrants,
  assetAssignments,
  assets,
  refreshTokens,
} from '../../../../../db/schema';

// ── Mock tx builder ───────────────────────────────────────────────────────────

/**
 * Builds a mock DbExecutor that records which table each update/delete targets.
 * Tables are identified by object identity (the actual imported Drizzle table
 * objects), so assertions can be made with `table === employees` etc.
 *
 * `assetReturnRows` controls what asset_assignments.returning() resolves to.
 */
function makeTx(assetReturnRows: Array<{ assetId: string }> = []) {
  const updateCalls: Array<{ table: unknown; chain: ReturnType<typeof makeUpdateChain> }> = [];
  const deleteCalls: Array<{ table: unknown }> = [];

  function makeUpdateChain(returning: unknown[] = []) {
    const c = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn().mockResolvedValue(returning),
    };
    c.set.mockReturnValue(c);
    c.where.mockImplementation(() => {
      return Object.assign(Promise.resolve(returning), c);
    });
    return c;
  }

  const updateMock = vi.fn().mockImplementation((table: unknown) => {
    const returning = table === assetAssignments ? assetReturnRows : [];
    const chain = makeUpdateChain(returning);
    updateCalls.push({ table, chain });
    return chain;
  });

  const deleteMock = vi.fn().mockImplementation((table: unknown) => {
    deleteCalls.push({ table });
    return { where: vi.fn().mockResolvedValue(undefined) };
  });

  return {
    update: updateMock,
    delete: deleteMock,
    _updateCalls: updateCalls,
    _deleteCalls: deleteCalls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const EMPLOYEE_ID = 'emp-abc';
const PAYLOAD = { employeeId: EMPLOYEE_ID, employeeEmail: 'alice@example.com' };

describe('OffboardingTypeDef.onApprove()', () => {
  let typeDef: OffboardingTypeDef;

  beforeEach(() => {
    const mockDb = { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const mockGraph = { isEnabled: vi.fn().mockReturnValue(false), disableEntraUser: vi.fn(), enableEntraUser: vi.fn() };
    typeDef = new OffboardingTypeDef({ register: vi.fn() } as never, mockDb as never, mockGraph as never);
  });

  it('updates employees table (sets status → offboarded)', async () => {
    const tx = makeTx();
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const employeeCall = tx._updateCalls.find((c) => c.table === employees);
    expect(employeeCall).toBeDefined();
    expect(employeeCall!.chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'offboarded' }),
    );
  });

  it('deletes user_role_assignments for the employee', async () => {
    const tx = makeTx();
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const roleDeleteCall = tx._deleteCalls.find((c) => c.table === userRoleAssignments);
    expect(roleDeleteCall).toBeDefined();
  });

  it('updates access_grants to set revokedAt (only active grants)', async () => {
    const tx = makeTx();
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const grantCall = tx._updateCalls.find((c) => c.table === accessGrants);
    expect(grantCall).toBeDefined();
    expect(grantCall!.chain.set).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('marks active asset_assignments as returned', async () => {
    const tx = makeTx([{ assetId: 'asset-1' }]);
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const assignmentCall = tx._updateCalls.find((c) => c.table === assetAssignments);
    expect(assignmentCall).toBeDefined();
    expect(assignmentCall!.chain.set).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ returnedAt: expect.any(Date) }),
    );
  });

  it('resets each returned asset to in_stock', async () => {
    const assetReturnRows = [{ assetId: 'asset-A' }, { assetId: 'asset-B' }];
    const tx = makeTx(assetReturnRows);
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const assetCalls = tx._updateCalls.filter((c) => c.table === assets);
    expect(assetCalls).toHaveLength(2);
    for (const call of assetCalls) {
      expect(call.chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'in_stock' }),
      );
    }
  });

  it('skips asset status reset when no active assignments exist', async () => {
    const tx = makeTx([]);
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const assetCalls = tx._updateCalls.filter((c) => c.table === assets);
    expect(assetCalls).toHaveLength(0);
  });

  it('revokes all active refresh tokens (sets revoked=true)', async () => {
    const tx = makeTx();
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);

    const tokenCall = tx._updateCalls.find((c) => c.table === refreshTokens);
    expect(tokenCall).toBeDefined();
    expect(tokenCall!.chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ revoked: true }),
    );
  });

  it('performs all 5 cleanup operations (4 updates + 1 delete)', async () => {
    const tx = makeTx([{ assetId: 'x' }]);
    await typeDef.onApprove(PAYLOAD, 'req-1', 'hr-user', tx as never);
    // employees + access_grants + asset_assignments + assets(×1) + refresh_tokens = 5 updates
    expect(tx._updateCalls).toHaveLength(5);
    // user_role_assignments = 1 delete
    expect(tx._deleteCalls).toHaveLength(1);
  });

  it('onReject is a no-op (mutates no state)', async () => {
    const tx = makeTx();
    await typeDef.onReject(PAYLOAD, 'req-1', 'hr-user', tx as never);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });
});

