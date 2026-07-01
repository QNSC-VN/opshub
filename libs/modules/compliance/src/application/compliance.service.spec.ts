/**
 * Unit tests — ComplianceService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplianceService } from './compliance.service';
import { ConflictException, NotFoundException, PreconditionFailedException } from '@platform';

const mockRepo = {
  findSoftwareByName:   vi.fn(),
  findSoftwareById:     vi.fn(),
  createSoftware:       vi.fn(),
  updateSoftware:       vi.fn(),
  listSoftware:         vi.fn(),
  createFinding:        vi.fn(),
  findFindingById:      vi.fn(),
  listFindings:         vi.fn(),
  setFindingStatus:     vi.fn(),
};

const mockAudit = { record: vi.fn() };
const ACTOR = { sub: 'admin-1', email: 'admin@test.com' };

const SOFTWARE = {
  id: 'sw-1',
  name: 'Slack',
  vendor: 'Salesforce',
  listing: 'whitelisted' as const,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FINDING = {
  id: 'f-1',
  title: 'Outdated OpenSSL',
  description: 'CVE-2024-1234',
  severity: 'high' as const,
  status: 'open' as const,
  assetId: 'asset-1',
  acknowledgedAt: null,
  resolvedAt: null,
  note: null,
  riskAccepted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService() {
  return new ComplianceService(mockRepo, mockAudit as never);
}

describe('ComplianceService.addSoftware()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a software entry when name is unique', async () => {
    mockRepo.findSoftwareByName.mockResolvedValue(null);
    mockRepo.createSoftware.mockResolvedValue(SOFTWARE);

    const result = await makeService().addSoftware({ name: 'Slack', listing: 'whitelisted' }, ACTOR);
    expect(result.name).toBe('Slack');
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'software.added' }));
  });

  it('throws ConflictException when software name already exists', async () => {
    mockRepo.findSoftwareByName.mockResolvedValue(SOFTWARE);
    await expect(makeService().addSoftware({ name: 'Slack', listing: 'whitelisted' }, ACTOR))
      .rejects.toBeInstanceOf(ConflictException);
    expect(mockRepo.createSoftware).not.toHaveBeenCalled();
  });
});

describe('ComplianceService.getSoftware()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns software when found', async () => {
    mockRepo.findSoftwareById.mockResolvedValue(SOFTWARE);
    const result = await makeService().getSoftware('sw-1');
    expect(result.id).toBe('sw-1');
  });

  it('throws NotFoundException when not found', async () => {
    mockRepo.findSoftwareById.mockResolvedValue(null);
    await expect(makeService().getSoftware('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ComplianceService.acknowledgeFinding()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('acknowledges an open finding', async () => {
    mockRepo.findFindingById.mockResolvedValue(FINDING);
    mockRepo.setFindingStatus.mockResolvedValue({ ...FINDING, status: 'acknowledged', acknowledgedAt: new Date() });

    const result = await makeService().acknowledgeFinding('f-1', ACTOR);
    expect(result.status).toBe('acknowledged');
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finding.acknowledged' }));
  });

  it('throws PreconditionFailedException when finding is already acknowledged', async () => {
    mockRepo.findFindingById.mockResolvedValue({ ...FINDING, status: 'acknowledged' });
    await expect(makeService().acknowledgeFinding('f-1', ACTOR))
      .rejects.toBeInstanceOf(PreconditionFailedException);
    expect(mockRepo.setFindingStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when finding does not exist', async () => {
    mockRepo.findFindingById.mockResolvedValue(null);
    await expect(makeService().acknowledgeFinding('ghost', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ComplianceService.resolveFinding()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves an open finding', async () => {
    mockRepo.findFindingById.mockResolvedValue(FINDING);
    mockRepo.setFindingStatus.mockResolvedValue({ ...FINDING, status: 'resolved', resolvedAt: new Date() });

    const result = await makeService().resolveFinding('f-1', 'Patched', false, ACTOR);
    expect(result.status).toBe('resolved');
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finding.resolved' }));
  });

  it('resolves an acknowledged finding', async () => {
    mockRepo.findFindingById.mockResolvedValue({ ...FINDING, status: 'acknowledged' });
    mockRepo.setFindingStatus.mockResolvedValue({ ...FINDING, status: 'resolved' });
    await expect(makeService().resolveFinding('f-1', null, true, ACTOR)).resolves.toBeDefined();
  });

  it('throws PreconditionFailedException when finding is already resolved', async () => {
    mockRepo.findFindingById.mockResolvedValue({ ...FINDING, status: 'resolved' });
    await expect(makeService().resolveFinding('f-1', null, false, ACTOR))
      .rejects.toBeInstanceOf(PreconditionFailedException);
  });
});
