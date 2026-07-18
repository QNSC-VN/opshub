/**
 * Unit tests — EmployeeService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmployeeService } from './employee.service';
import { ConflictException, NotFoundException } from '@platform';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockEmployeeRepo = {
  findByEmail: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  list: vi.fn(),
};
const mockRefreshTokenRepo = { revokeAllForEmployee: vi.fn() };
const mockAuthCache = {
  revokeUser: vi.fn(),
  unrevokeUser: vi.fn(),
  isUserRevoked: vi.fn(),
  isTokenDenied: vi.fn(),
};
const mockStorage = {
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
  getDownloadUrl: vi.fn(),
  deleteFile: vi.fn(),
};
const mockAudit = { record: vi.fn() };

const ACTOR = { sub: 'admin-1', email: 'admin@acme.com' };

const EMPLOYEE = {
  id: 'emp-1',
  email: 'jane@acme.com',
  displayName: 'Jane Doe',
  department: 'Engineering',
  jobTitle: 'Engineer',
  managerId: null,
  roles: ['employee'],
  status: 'active' as const,
  entraOid: null,
  createdAt: new Date(),
};

function makeService() {
  return new EmployeeService(
    mockEmployeeRepo as never,
    mockRefreshTokenRepo as never,
    mockAuthCache as never,
    mockStorage as never,
    mockAudit as never,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EmployeeService.create()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an employee when email is unique', async () => {
    mockEmployeeRepo.findByEmail.mockResolvedValue(null);
    mockEmployeeRepo.create.mockResolvedValue(EMPLOYEE);

    const result = await makeService().create(
      { email: 'jane@acme.com', displayName: 'Jane Doe', roles: [] },
      ACTOR,
    );
    expect(result.email).toBe('jane@acme.com');
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'employee.created' }),
    );
  });

  it('lowercases email before checking uniqueness', async () => {
    mockEmployeeRepo.findByEmail.mockResolvedValue(null);
    mockEmployeeRepo.create.mockResolvedValue({ ...EMPLOYEE, email: 'jane@acme.com' });

    await makeService().create({ email: 'JANE@ACME.COM', displayName: 'Jane', roles: [] }, ACTOR);
    expect(mockEmployeeRepo.findByEmail).toHaveBeenCalledWith('jane@acme.com');
  });

  it('throws ConflictException when email already exists', async () => {
    mockEmployeeRepo.findByEmail.mockResolvedValue(EMPLOYEE);
    await expect(
      makeService().create({ email: 'jane@acme.com', displayName: 'Jane', roles: [] }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockEmployeeRepo.create).not.toHaveBeenCalled();
  });
});

describe('EmployeeService.getById()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns employee when found', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(EMPLOYEE);
    const result = await makeService().getById('emp-1');
    expect(result.id).toBe('emp-1');
  });

  it('throws NotFoundException when not found', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(null);
    await expect(makeService().getById('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EmployeeService.update()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates allowed fields and records audit', async () => {
    const updated = { ...EMPLOYEE, displayName: 'Jane Smith', jobTitle: 'Lead' };
    mockEmployeeRepo.findById.mockResolvedValue(EMPLOYEE);
    mockEmployeeRepo.update.mockResolvedValue(updated);

    const result = await makeService().update(
      'emp-1',
      { displayName: 'Jane Smith', jobTitle: 'Lead' },
      ACTOR,
    );
    expect(result.displayName).toBe('Jane Smith');
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'employee.updated' }),
    );
  });

  it('throws NotFoundException when employee does not exist', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(null);
    await expect(makeService().update('ghost', { displayName: 'X' }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EmployeeService.updateStatus()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates status and emits audit', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(EMPLOYEE);
    mockEmployeeRepo.updateStatus.mockResolvedValue({ ...EMPLOYEE, status: 'on_leave' });

    const result = await makeService().updateStatus('emp-1', 'on_leave', ACTOR);
    expect(result.status).toBe('on_leave');
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'employee.status_changed' }),
    );
  });

  it('returns existing employee without DB call when status unchanged', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(EMPLOYEE); // already 'active'
    const result = await makeService().updateStatus('emp-1', 'active', ACTOR);
    expect(result.status).toBe('active');
    expect(mockEmployeeRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('revokes refresh tokens when offboarded', async () => {
    mockEmployeeRepo.findById.mockResolvedValue(EMPLOYEE);
    mockEmployeeRepo.updateStatus.mockResolvedValue({ ...EMPLOYEE, status: 'offboarded' });
    mockRefreshTokenRepo.revokeAllForEmployee.mockResolvedValue(undefined);

    await makeService().updateStatus('emp-1', 'offboarded', ACTOR);
    expect(mockRefreshTokenRepo.revokeAllForEmployee).toHaveBeenCalledWith('emp-1');
    expect(mockAuthCache.revokeUser).toHaveBeenCalledWith('emp-1', expect.any(Number));
  });
});
