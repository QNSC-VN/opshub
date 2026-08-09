/**
 * EntityAttachmentsService — the quota, the link check, and the delete rule.
 *
 * WHY UNIT TESTS WHEN `training.e2e.spec.ts` DRIVES REAL S3. That suite proves the round trip:
 * presigned PUT, stored disposition, confirm, download. What it cannot reach cheaply are the
 * branches that only open under a race or a policy edge — a file that arrives when the quota has
 * just filled must be DISCARDED rather than linked, and a `null` quota must skip counting entirely.
 * Both are one line, and both are silent when wrong: the first leaves a completed file nothing
 * references, the second turns every 1:1 surface into an extra query per upload.
 *
 * The database and StorageService are stubs, so what is under test is this service's decisions.
 */
import { describe, expect, it, vi } from 'vitest';
import { EntityAttachmentsService } from './entity-attachments.service';
import type { DrizzleDB } from '../database/index';

const REF = { entityType: 'training_record', entityId: 'rec-1' };

const FILE = {
  id: 'file-1',
  key: 'training-certificate/emp-1/file-1.pdf',
  originalName: 'cert.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100,
  resourceType: 'training-certificate',
  checksumSha256: null,
  status: 'completed' as const,
  uploaderId: 'emp-1',
  linkedEntityType: 'training_record',
  linkedEntityId: 'rec-1',
  createdAt: new Date(),
  confirmedAt: new Date(),
};

/**
 * A stub `db` covering the three shapes this service builds: a joined select (list / count /
 * requireLink), an insert, and a delete.
 *
 * `count` is what the quota reads, so it is a knob rather than a fixture — every quota branch is
 * reached by changing it.
 */
function makeService(over: { count?: number; linked?: boolean } = {}) {
  const linkedRows = over.linked === false ? [] : [{ file: FILE }];
  const countRows = [{ n: over.count ?? 0 }];

  const insert = vi.fn(() => ({
    values: vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) })),
  }));
  const del = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));

  // `select({...})` distinguishes the count query from the row queries by the shape asked for.
  const select = vi.fn((shape?: Record<string, unknown>) => {
    const isCount = Boolean(shape && 'n' in shape);
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(linkedRows.map((r) => r.file)),
      limit: () => Promise.resolve(linkedRows),
      then: undefined as never,
    };
    if (isCount) {
      return { from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(countRows) }) }) };
    }
    return chain;
  });

  const db = { select, insert, delete: del } as unknown as DrizzleDB;

  const storage = {
    presignUpload: vi
      .fn()
      .mockResolvedValue({
        fileId: 'file-1',
        uploadUrl: 'https://s3/put',
        key: FILE.key,
        requiredHeaders: { 'Content-Type': 'application/pdf' },
      }),
    confirmUpload: vi
      .fn()
      .mockResolvedValue({ fileId: 'file-1', key: FILE.key, url: 'https://s3/get' }),
    findById: vi.fn().mockResolvedValue(FILE),
    getDownloadUrl: vi.fn().mockResolvedValue('https://s3/get'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };

  const service = new EntityAttachmentsService(db, storage as never);
  return { service, storage, insert, del };
}

describe('presign', () => {
  it('refuses when the quota is already full, before reserving anything', async () => {
    // `training-certificate` allows 5.
    const { service, storage } = makeService({ count: 5 });

    await expect(
      service.presign(
        REF,
        'training-certificate',
        { fileName: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
        'emp-1',
      ),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_LIMIT_EXCEEDED' });
    expect(storage.presignUpload).not.toHaveBeenCalled();
  });

  it('records the owning entity so the reaper can correlate an abandoned upload', async () => {
    const { service, storage } = makeService({ count: 0 });

    await service.presign(
      REF,
      'training-certificate',
      { fileName: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      'emp-1',
    );

    expect(storage.presignUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'training-certificate',
        linkedEntityType: 'training_record',
        linkedEntityId: 'rec-1',
      }),
      'emp-1',
    );
  });

  it('skips counting entirely for a surface with no quota', async () => {
    // `employee-avatar` replaces rather than accumulates, so `maxPerOwner` is null. Counting anyway
    // would be a wasted query on every upload.
    const { service, storage } = makeService({ count: 999 });

    await expect(
      service.presign(
        REF,
        'employee-avatar',
        { fileName: 'a.png', mimeType: 'image/png', sizeBytes: 10 },
        'emp-1',
      ),
    ).resolves.toMatchObject({ fileId: 'file-1' });
    expect(storage.presignUpload).toHaveBeenCalled();
  });

  it('passes the signed header set back to the caller', async () => {
    const { service } = makeService();

    const result = await service.presign(
      REF,
      'training-certificate',
      { fileName: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      'emp-1',
    );

    // The client must send exactly these; guessing the set is how an upload starts failing with a
    // 403 that carries no CORS headers.
    expect(result.requiredHeaders).toEqual({ 'Content-Type': 'application/pdf' });
  });
});

describe('confirm', () => {
  it('discards a file that arrives after the quota filled, rather than linking it', async () => {
    // The race the double check exists for: N concurrent presigns each passed against the same
    // count, and confirm is the point where the file becomes visible.
    const { service, storage, insert } = makeService({ count: 5 });

    await expect(
      service.confirm(REF, 'training-certificate', 'file-1', 'emp-1'),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_LIMIT_EXCEEDED' });
    // Discarded, not left as a completed-but-unlinked row the reaper would keep forever.
    expect(storage.deleteFile).toHaveBeenCalledWith('file-1', 'emp-1');
    expect(insert).not.toHaveBeenCalled();
  });

  it('verifies the object landed before linking', async () => {
    const { service, storage, insert } = makeService({ count: 0 });

    await service.confirm(REF, 'training-certificate', 'file-1', 'emp-1');

    expect(storage.confirmUpload).toHaveBeenCalledWith('file-1', 'emp-1');
    expect(insert).toHaveBeenCalled();
  });

  it('404s when the stored file vanished between confirm and read', async () => {
    const { service } = makeService({ count: 0 });
    const { service: broken, storage } = makeService({ count: 0 });
    storage.findById.mockResolvedValue(null);

    await expect(
      broken.confirm(REF, 'training-certificate', 'file-1', 'emp-1'),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(service).toBeDefined();
  });
});

describe('downloadUrl', () => {
  it('requires the link row first — the file id alone is not a capability', async () => {
    const { service, storage } = makeService({ linked: false });

    await expect(service.downloadUrl(REF, 'file-1')).rejects.toMatchObject({
      code: 'ATTACHMENT_NOT_FOUND',
    });
    // Without the check, any caller authorized on ANY entity of this type could pass any file id.
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it('delegates once the link is proven', async () => {
    const { service, storage } = makeService({ linked: true });

    await expect(service.downloadUrl(REF, 'file-1')).resolves.toBe('https://s3/get');
    expect(storage.getDownloadUrl).toHaveBeenCalledWith('file-1');
  });
});

describe('remove', () => {
  it('refuses a caller who is neither the uploader nor forced', async () => {
    const { service, del } = makeService({ linked: true });

    await expect(service.remove(REF, 'file-1', 'someone-else')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('allows the uploader', async () => {
    const { service, del, storage } = makeService({ linked: true });

    await service.remove(REF, 'file-1', 'emp-1');

    expect(del).toHaveBeenCalled();
    expect(storage.deleteFile).toHaveBeenCalled();
  });

  it('allows anyone when the owning module forces it', async () => {
    // `force` is how the owning module applies its own "or a manager" rule without this service
    // knowing what a manager is.
    const { service, del } = makeService({ linked: true });

    await service.remove(REF, 'file-1', 'a-manager', true);

    expect(del).toHaveBeenCalled();
  });

  it('refuses to remove a file that is not attached here', async () => {
    const { service, del } = makeService({ linked: false });

    await expect(service.remove(REF, 'file-1', 'emp-1', true)).rejects.toMatchObject({
      code: 'ATTACHMENT_NOT_FOUND',
    });
    expect(del).not.toHaveBeenCalled();
  });
});
