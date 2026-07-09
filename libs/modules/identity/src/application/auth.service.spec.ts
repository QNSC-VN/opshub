/**
 * Unit tests — AuthService.refresh()
 *
 * Focus: single-use refresh-token rotation must stay robust under benign
 * concurrent/retried reuse (multi-tab, lost response, StrictMode, true races)
 * without falsely tripping family-wide theft revocation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const jwt = { signAsync: vi.fn().mockResolvedValue('access-jwt') };
const config = {
  get: vi.fn((key: string) => {
    if (key === 'JWT_REFRESH_EXPIRY_DAYS') return 7;
    if (key === 'JWT_ACCESS_EXPIRY') return '15m';
    return undefined;
  }),
};
const cache = {
  isAvailable: true,
  getJson: vi.fn(),
  setJson: vi.fn().mockResolvedValue(undefined),
};
const audit = { record: vi.fn() };
const authzAdmin = {};
const employeeRepo = { findById: vi.fn() };
const refreshTokenRepo = {
  findByHash: vi.fn(),
  revokeById: vi.fn(),
  revokeByIdIfActive: vi.fn(),
  revokeFamily: vi.fn(),
  create: vi.fn(),
};

const EMPLOYEE = {
  id: 'emp-1',
  email: 'jane@acme.com',
  displayName: 'Jane Doe',
  roles: ['employee'],
  status: 'active' as const,
};

const STORED = {
  id: 'tok-1',
  employeeId: 'emp-1',
  tokenHash: 'stored-hash',
  familyId: 'fam-1',
  authMethod: 'sso' as const,
  expiresAt: new Date(Date.now() + 86_400_000),
  revoked: false,
};

const CACHED = { accessToken: 'cached-jwt', expiresIn: 900, rawRefreshToken: 'cached-raw' };

function makeService(): AuthService {
  return new AuthService(
    jwt as never,
    config as never,
    cache as never,
    audit as never,
    authzAdmin as never,
    employeeRepo as never,
    refreshTokenRepo as never,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AuthService.refresh()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.isAvailable = true;
    cache.getJson.mockResolvedValue(null);
    cache.setJson.mockResolvedValue(undefined);
  });

  it('rotates atomically and caches the result in the grace window on success', async () => {
    refreshTokenRepo.findByHash.mockResolvedValue({ ...STORED });
    refreshTokenRepo.revokeByIdIfActive.mockResolvedValue(true);
    employeeRepo.findById.mockResolvedValue(EMPLOYEE);

    const result = await makeService().refresh('raw-token');

    expect(refreshTokenRepo.revokeByIdIfActive).toHaveBeenCalledWith('tok-1');
    expect(refreshTokenRepo.revokeFamily).not.toHaveBeenCalled();
    expect(cache.setJson).toHaveBeenCalledWith(
      expect.stringContaining('refresh:grace:'),
      result,
      expect.any(Number),
    );
    expect(result.accessToken).toBe('access-jwt');
  });

  it('replays cached successor tokens on benign reuse within the grace window', async () => {
    refreshTokenRepo.findByHash.mockResolvedValue({ ...STORED, revoked: true });
    cache.getJson.mockResolvedValue(CACHED);

    const result = await makeService().refresh('raw-token');

    expect(result).toEqual(CACHED);
    expect(refreshTokenRepo.revokeFamily).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does NOT revoke the family when the grace lookup is unavailable (cache outage)', async () => {
    refreshTokenRepo.findByHash.mockResolvedValue({ ...STORED, revoked: true });
    cache.isAvailable = false;

    await expect(makeService().refresh('raw-token')).rejects.toThrow();
    expect(refreshTokenRepo.revokeFamily).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('replays the winner result when it loses the atomic rotation race', async () => {
    refreshTokenRepo.findByHash.mockResolvedValue({ ...STORED });
    refreshTokenRepo.revokeByIdIfActive.mockResolvedValue(false);
    cache.getJson.mockResolvedValue(CACHED);

    const result = await makeService().refresh('raw-token');

    expect(result).toEqual(CACHED);
    expect(refreshTokenRepo.revokeFamily).not.toHaveBeenCalled();
    expect(employeeRepo.findById).not.toHaveBeenCalled();
  });

  it('revokes the family on genuine reuse outside the grace window (theft)', async () => {
    refreshTokenRepo.findByHash.mockResolvedValue({ ...STORED, revoked: true });
    cache.getJson.mockResolvedValue(null);

    await expect(makeService().refresh('raw-token')).rejects.toThrow();
    expect(refreshTokenRepo.revokeFamily).toHaveBeenCalledWith('fam-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.token_theft_detected' }),
    );
  });
});
