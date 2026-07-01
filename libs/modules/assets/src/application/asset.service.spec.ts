/**
 * Unit tests — AssetService
 *
 * All infrastructure dependencies (repository, DB, outbox, audit, employees)
 * are mocked via vi.fn() — no real DB required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetService } from './asset.service';
import {
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
} from '@platform';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAssetRepo = {
  findByTag:      vi.fn(),
  findById:       vi.fn(),
  create:         vi.fn(),
  assign:         vi.fn(),
  unassign:       vi.fn(),
  retire:         vi.fn(),
  list:           vi.fn(),
  listAssignments:vi.fn(),
};

const mockDb = {
  transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
};

const mockOutbox  = { enqueue: vi.fn() };
const mockStorage = { presignUpload: vi.fn(), confirmUpload: vi.fn(), getDownloadUrl: vi.fn(), deleteFile: vi.fn() };
const mockAudit   = { record: vi.fn() };
const mockEmployees = { getById: vi.fn() };

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACTOR = { sub: 'user-1', email: 'admin@test.com' };

const ASSET_BASE = {
  id: 'asset-1',
  assetTag: 'TAG-001',
  type: 'laptop',
  manufacturer: 'Dell',
  model: 'Latitude',
  serialNumber: null,
  status: 'in_stock' as const,
  assignedTo: null,
  notes: null,
  purchasedAt: null,
  createdAt: new Date(),
};

// ── Service factory ───────────────────────────────────────────────────────────

function makeService() {
  return new AssetService(
    mockAssetRepo as never,
    mockDb as never,
    mockOutbox as never,
    mockStorage as never,
    mockAudit as never,
    mockEmployees as never,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AssetService.create()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an asset when tag is unique', async () => {
    mockAssetRepo.findByTag.mockResolvedValue(null);
    mockAssetRepo.create.mockResolvedValue(ASSET_BASE);

    const svc = makeService();
    const result = await svc.create(
      { assetTag: 'TAG-001', type: 'laptop', manufacturer: 'Dell', model: 'Latitude' },
      ACTOR,
    );

    expect(result.id).toBe('asset-1');
    expect(mockAssetRepo.create).toHaveBeenCalledOnce();
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'asset.created' }));
  });

  it('throws ConflictException when tag already exists', async () => {
    mockAssetRepo.findByTag.mockResolvedValue(ASSET_BASE);
    const svc = makeService();
    await expect(
      svc.create({ assetTag: 'TAG-001', type: 'laptop' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mockAssetRepo.create).not.toHaveBeenCalled();
  });
});

describe('AssetService.getById()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns asset when found', async () => {
    mockAssetRepo.findById.mockResolvedValue(ASSET_BASE);
    const result = await makeService().getById('asset-1');
    expect(result.assetTag).toBe('TAG-001');
  });

  it('throws NotFoundException when asset missing', async () => {
    mockAssetRepo.findById.mockResolvedValue(null);
    await expect(makeService().getById('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AssetService.assign()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns an available asset', async () => {
    mockAssetRepo.findById.mockResolvedValue(ASSET_BASE);
    mockEmployees.getById.mockResolvedValue({ id: 'emp-1', status: 'active' });
    const updatedAsset = { ...ASSET_BASE, status: 'assigned' as const, assignedTo: 'emp-1' };
    mockAssetRepo.assign.mockResolvedValue(updatedAsset);
    // After assign, getById is called again to return updated state
    mockAssetRepo.findById.mockResolvedValueOnce(ASSET_BASE).mockResolvedValueOnce(updatedAsset);

    await makeService().assign('asset-1', 'emp-1', null, ACTOR);
    expect(mockOutbox.enqueue).toHaveBeenCalledOnce();
  });

  it('throws PreconditionFailedException when asset is retired', async () => {
    mockAssetRepo.findById.mockResolvedValue({ ...ASSET_BASE, status: 'retired' });
    await expect(makeService().assign('asset-1', 'emp-1', null, ACTOR))
      .rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('throws ConflictException when asset is already assigned', async () => {
    mockAssetRepo.findById.mockResolvedValue({ ...ASSET_BASE, status: 'assigned', assignedTo: 'emp-2' });
    await expect(makeService().assign('asset-1', 'emp-1', null, ACTOR))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AssetService.unassign()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unassigns an assigned asset', async () => {
    const assignedAsset = { ...ASSET_BASE, status: 'assigned' as const, assignedTo: 'emp-1' };
    mockAssetRepo.findById.mockResolvedValue(assignedAsset);
    const unassignedAsset = { ...ASSET_BASE, status: 'in_stock' as const, assignedTo: null };
    mockAssetRepo.unassign.mockResolvedValue(unassignedAsset);

    await makeService().unassign('asset-1', ACTOR);
    expect(mockOutbox.enqueue).toHaveBeenCalledOnce();
  });

  it('throws PreconditionFailedException when asset is not assigned', async () => {
    mockAssetRepo.findById.mockResolvedValue(ASSET_BASE); // in_stock, no assignedTo
    await expect(makeService().unassign('asset-1', ACTOR))
      .rejects.toBeInstanceOf(PreconditionFailedException);
  });
});

describe('AssetService.retire()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retires an in-stock asset', async () => {
    mockAssetRepo.findById.mockResolvedValue(ASSET_BASE);
    mockAssetRepo.retire.mockResolvedValue({ ...ASSET_BASE, status: 'retired' as const });
    await makeService().retire('asset-1', ACTOR);
    expect(mockOutbox.enqueue).toHaveBeenCalledOnce();
  });

  it('throws PreconditionFailedException when asset is already retired', async () => {
    mockAssetRepo.findById.mockResolvedValue({ ...ASSET_BASE, status: 'retired' as const });
    await expect(makeService().retire('asset-1', ACTOR)).rejects.toBeInstanceOf(PreconditionFailedException);
  });

  it('throws PreconditionFailedException when asset is currently assigned', async () => {
    mockAssetRepo.findById.mockResolvedValue({ ...ASSET_BASE, status: 'assigned' as const, assignedTo: 'emp-1' });
    await expect(makeService().retire('asset-1', ACTOR)).rejects.toBeInstanceOf(PreconditionFailedException);
  });
});
