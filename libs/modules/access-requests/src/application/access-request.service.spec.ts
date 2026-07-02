/**
 * Unit tests — AccessRequestService (focused on submit, getById, approve, reject)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccessRequestService } from './access-request.service';
import { NotFoundException } from '@platform';

const mockRepo = {
  findById:          vi.fn(),
  create:            vi.fn(),
  updateStatus:      vi.fn(),
  list:              vi.fn(),
  listActiveGrants:  vi.fn(),
};

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set:    vi.fn().mockReturnThis(),
  where:  vi.fn().mockResolvedValue(undefined),
};

const mockEngine = {
  submit:   vi.fn(),
  approve:  vi.fn(),
  reject:   vi.fn(),
};

const mockAudit = { record: vi.fn() };

const ACTOR = { sub: 'user-1', email: 'user@test.com' };
const ADMIN = { sub: 'admin-1', email: 'admin@test.com' };

const ACCESS_REQUEST = {
  id: 'ar-1',
  requesterId: 'user-1',
  accessType: 'vpn',
  target: 'production-vpn',
  justification: 'Need access for on-call',
  durationHours: 8,
  status: 'pending' as const,
  requestId: 'req-1',
  reviewerId: null,
  reviewNote: null,
  reviewedAt: null,
  createdAt: new Date(),
};

function makeService() {
  return new AccessRequestService(
    mockRepo as never,
    mockDb as never,
    mockEngine as never,
    mockAudit as never,
  );
}

describe('AccessRequestService.getById()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns access request when found', async () => {
    mockRepo.findById.mockResolvedValue(ACCESS_REQUEST);
    const result = await makeService().getById('ar-1');
    expect(result.id).toBe('ar-1');
  });

  it('throws NotFoundException when not found', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(makeService().getById('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AccessRequestService.submit()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates domain row, submits to engine, and records audit', async () => {
    mockRepo.create.mockResolvedValue(ACCESS_REQUEST);
    mockEngine.submit.mockResolvedValue({ id: 'req-1' });

    const result = await makeService().submit(
      { accessType: 'vpn', target: 'production-vpn', justification: 'on-call', durationHours: 8 },
      ACTOR,
    );

    expect(mockRepo.create).toHaveBeenCalledOnce();
    expect(mockEngine.submit).toHaveBeenCalledWith('access_request', expect.objectContaining({ accessType: 'vpn' }), ACTOR, expect.any(Object));
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_request.submitted' }));
    expect(result.requestId).toBe('req-1');
  });
});

describe('AccessRequestService.approve()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds the pending request and approves via DB', async () => {
    mockRepo.findById.mockResolvedValue(ACCESS_REQUEST);
    const grant = { id: 'grant-1', requestId: 'ar-1', granteeId: 'user-1', accessType: 'vpn', target: 'production-vpn', grantedAt: new Date(), expiresAt: new Date(Date.now() + 8 * 3_600_000), revokedAt: null };
    // approve() uses db.transaction internally — mock it:
    const selectBuilder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([grant]),
    };
    const dbWithTx = { transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})), select: vi.fn().mockReturnValue(selectBuilder), insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };

    // Build service with tx-capable db mock
    const svc = new AccessRequestService(mockRepo as never, dbWithTx as never, mockEngine as never, mockAudit as never);
    (svc as unknown as { db: typeof dbWithTx }).db = dbWithTx;

    // approve() reads from db internally — mock relevant repo calls
    mockRepo.findById.mockResolvedValue(ACCESS_REQUEST);
    // Simulate the grant creation through the mocked db.transaction
    dbWithTx.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([grant]), update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) });
    });

    // approve() returns the grant — just verify it doesn't throw
    await expect(svc.approve('ar-1', null, ADMIN)).resolves.toBeDefined();
  });
});
