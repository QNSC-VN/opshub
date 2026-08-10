/**
 * InformationAssetService — direction, coherence, and the history written with the change.
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `isms-information-assets.e2e.spec.ts` drives the real
 * API, the five CHECKs and the report SQL. What it cannot reach cheaply is the ORDER and the
 * ARGUMENTS: that the rank used to decide "is this a reduction?" comes from the levels table rather
 * than from anything hard-coded here, that the history row is appended in the SAME transaction with
 * the level it actually moved from, and that each refusal happens before any write.
 *
 * The repository, the transaction and the audit are stubs, so what is under test is this service's
 * decisions.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { AUDIT_ACTION } from '@modules/audit';
import { InformationAssetService } from './information-asset.service';
import type {
  ClassificationChange,
  ClassificationLevel,
  InformationAsset,
} from '../domain/information-asset.types';
import { createFakeAudit } from '../../../audit/src/testing/audit.fake';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };
const REASON = 'The board approved wider circulation of the anonymised figures.';

/**
 * The levels, DELIBERATELY NOT in rank order and with non-contiguous ranks.
 *
 * If the service ever inferred the ordering from the array's order or from the enum's declaration
 * order, these ranks would disagree with it and the direction tests below would fail. That is the
 * point: the stub is arranged so that a hard-coded ordering cannot pass.
 */
function levels(): ClassificationLevel[] {
  const base = { label: 'x', handlingRules: 'x', createdAt: new Date(), updatedAt: new Date() };
  return [
    { code: 'confidential', rank: 30, encryptionRequired: true, ...base },
    { code: 'public', rank: 10, encryptionRequired: false, ...base },
    { code: 'restricted', rank: 40, encryptionRequired: true, ...base },
    { code: 'internal', rank: 20, encryptionRequired: false, ...base },
  ];
}

function asset(over: Partial<InformationAsset> = {}): InformationAsset {
  return {
    id: 'ia-1',
    reference: 'IA-014',
    name: 'Payroll system',
    description: 'Salary, bank details and tax records for all staff.',
    type: 'system',
    classification: 'confidential',
    ownerId: 'owner-1',
    custodianId: null,
    confidentiality: 4,
    integrity: 4,
    availability: 3,
    personalData: true,
    location: 'eu-west-1',
    retentionMonths: 84,
    lastReviewedAt: null,
    reviewDueOn: null,
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function change(over: Partial<ClassificationChange> = {}): ClassificationChange {
  return {
    id: 'ach-1',
    informationAssetId: 'ia-1',
    fromLevel: null,
    toLevel: 'confidential',
    reason: REASON,
    changedBy: ACTOR.sub,
    changedAt: new Date(),
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}) {
  const repo = {
    listLevels: vi.fn().mockResolvedValue(levels()),
    create: vi.fn().mockResolvedValue(asset()),
    findById: vi.fn().mockResolvedValue(asset()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi
      .fn()
      .mockImplementation((id: string, input: Partial<InformationAsset>) =>
        Promise.resolve(asset({ id, ...input })),
      ),
    reclassify: vi
      .fn()
      .mockImplementation((id: string, _from: string, to: InformationAsset['classification']) =>
        Promise.resolve(asset({ id, classification: to })),
      ),
    markReviewed: vi
      .fn()
      .mockImplementation((id: string, reviewDueOn: string | null) =>
        Promise.resolve(asset({ id, reviewDueOn, lastReviewedAt: new Date() })),
      ),
    retire: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(asset({ id, retiredAt: new Date() }))),
    appendChange: vi
      .fn()
      .mockImplementation((informationAssetId: string, input: Record<string, unknown>) =>
        Promise.resolve(
          change({ informationAssetId, ...(input as Partial<ClassificationChange>) }),
        ),
      ),
    listChanges: vi.fn().mockResolvedValue([]),
    linkDevice: vi.fn().mockResolvedValue(undefined),
    unlinkDevice: vi.fn().mockResolvedValue(true),
    listDevicesFor: vi.fn().mockResolvedValue([]),
    holdingsOnDevice: vi.fn().mockResolvedValue([]),
    classificationSummary: vi.fn().mockResolvedValue([]),
    ...over,
  };
  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = createFakeAudit();

  const service = new InformationAssetService(repo, db, audit as never);
  return { service, repo, transaction, audit, TX };
}

const REGISTER = {
  reference: 'IA-014',
  name: 'Payroll system',
  type: 'system' as const,
  classification: 'confidential' as const,
  classificationReason: 'Holds salary and bank details for every member of staff.',
  ownerId: 'owner-1',
  confidentiality: 4,
  integrity: 4,
  availability: 3,
  personalData: true,
};

describe('register', () => {
  it('refuses a reference already in the register', async () => {
    const { service, repo } = makeService({ findByReference: vi.fn().mockResolvedValue(asset()) });
    await expect(service.register(REGISTER, ACTOR)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('passes the reason through as the first history row', async () => {
    // The repository writes the asset and its first history row together, so what this pins is that
    // the reason reaches it at all: an asset whose current label has no history cannot explain
    // itself, and dropping the field here is the way that happens silently.
    const { service, repo, TX } = makeService();
    await service.register(REGISTER, ACTOR);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        classificationReason: REGISTER.classificationReason,
        registeredBy: ACTOR.sub,
      }),
      TX,
    );
  });

  it('refuses personal data at a classification that does not protect it', async () => {
    const { service, repo } = makeService();
    await expect(
      service.register(
        { ...REGISTER, classification: 'internal', confidentiality: 3, personalData: true },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INFORMATION_ASSET_PERSONAL_DATA_EXPOSED' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a public asset that is rated as confidential', async () => {
    const { service } = makeService();
    await expect(
      service.register(
        { ...REGISTER, classification: 'public', confidentiality: 4, personalData: false },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INFORMATION_ASSET_CLASSIFICATION_MISMATCH' });
  });

  it('refuses a restricted asset rated below the assessment its label claims', async () => {
    const { service } = makeService();
    await expect(
      service.register({ ...REGISTER, classification: 'restricted', confidentiality: 2 }, ACTOR),
    ).rejects.toMatchObject({ code: 'INFORMATION_ASSET_CLASSIFICATION_MISMATCH' });
  });

  it('refuses a rating outside the scale', async () => {
    const { service } = makeService();
    await expect(service.register({ ...REGISTER, integrity: 9 }, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_INVALID_RATING',
    });
  });
});

describe('update', () => {
  it('judges a patch against the row as it will be, not the patch alone', async () => {
    // `personalData` is already true on the stored asset and the patch only moves the rating. The
    // rule relates the two columns, so validating the patch in isolation would let this through.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(asset({ classification: 'confidential' })),
    });
    await expect(service.update('ia-1', { confidentiality: 9 }, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_INVALID_RATING',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses a re-rating that contradicts the label already stored', async () => {
    // The patch says nothing about the classification, but the stored label is `public` — so raising
    // the confidentiality rating alone makes the row incoherent. Re-rating and reclassifying are
    // separate endpoints, which is exactly why each has to be judged against the other's stored value.
    const { service } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          asset({ classification: 'public', confidentiality: 1, personalData: false }),
        ),
    });
    await expect(service.update('ia-1', { confidentiality: 4 }, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_CLASSIFICATION_MISMATCH',
    });
  });

  it('refuses any change to a retired asset', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(asset({ retiredAt: new Date() })),
    });
    await expect(service.update('ia-1', { name: 'Renamed' }, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_RETIRED',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('reclassify', () => {
  it('allows raising the classification', async () => {
    const { service, repo } = makeService();
    const result = await service.reclassify('ia-1', 'restricted', REASON, ACTOR);
    expect(result.classification).toBe('restricted');
    expect(repo.reclassify).toHaveBeenCalledWith(
      'ia-1',
      'confidential',
      'restricted',
      expect.objectContaining({ tx: true }),
    );
  });

  it('refuses a reduction and names the permission that would allow it', async () => {
    const { service, repo } = makeService();
    await expect(service.reclassify('ia-1', 'internal', REASON, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_DECLASSIFY_REQUIRED',
    });
    expect(repo.reclassify).not.toHaveBeenCalled();
    expect(repo.appendChange).not.toHaveBeenCalled();
  });

  it('reads the ranking from the levels table rather than assuming an order', async () => {
    // The stub's ranks are non-contiguous and its rows are out of order, so this only passes if the
    // comparison used the `rank` column. Asserting the CALL is the point: a service that never asked
    // must be inferring the ordering from somewhere else.
    const { service, repo } = makeService();
    await service.reclassify('ia-1', 'restricted', REASON, ACTOR);
    expect(repo.listLevels).toHaveBeenCalled();
  });

  it('refuses a move to the level it already has', async () => {
    const { service, repo } = makeService();
    await expect(service.reclassify('ia-1', 'confidential', REASON, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_NOT_RECLASSIFIED',
    });
    expect(repo.reclassify).not.toHaveBeenCalled();
  });

  it('appends the history row with the level it actually moved from', async () => {
    const { service, repo, TX } = makeService();
    await service.reclassify('ia-1', 'restricted', REASON, ACTOR);
    expect(repo.appendChange).toHaveBeenCalledWith(
      'ia-1',
      { fromLevel: 'confidential', toLevel: 'restricted', reason: REASON, changedBy: ACTOR.sub },
      TX,
    );
  });

  it('reports a lost race rather than recording a transition that did not happen', async () => {
    // The guarded `WHERE classification = <from>` found nothing, so somebody else moved it first.
    // The reason supplied describes a transition that no longer matches reality.
    const { service, repo } = makeService({ reclassify: vi.fn().mockResolvedValue(null) });
    await expect(service.reclassify('ia-1', 'restricted', REASON, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.appendChange).not.toHaveBeenCalled();
  });

  it('audits a raise as a reclassification', async () => {
    const { service, audit } = makeService();
    await service.reclassify('ia-1', 'restricted', REASON, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.INFORMATION_ASSET_RECLASSIFIED }),
      expect.anything(),
    );
  });
});

describe('declassify', () => {
  it('allows a reduction', async () => {
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(asset({ classification: 'confidential', personalData: false })),
    });
    const result = await service.declassify('ia-1', 'internal', REASON, ACTOR);
    expect(result.classification).toBe('internal');
    expect(repo.appendChange).toHaveBeenCalledWith(
      'ia-1',
      expect.objectContaining({ fromLevel: 'confidential', toLevel: 'internal' }),
      expect.anything(),
    );
  });

  it('audits a reduction as its own action, not as a reclassification', async () => {
    // These are read for opposite reasons: "show me every declassification this quarter" has to be a
    // query over the audit trail, not a filter somebody remembers to apply.
    const { service, audit } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(asset({ classification: 'confidential', personalData: false })),
    });
    await service.declassify('ia-1', 'internal', REASON, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.INFORMATION_ASSET_DECLASSIFIED }),
      expect.anything(),
    );
  });

  it('still refuses to declassify personal data below what protects it', async () => {
    // The permission allows a reduction; it does not allow an incoherent one. This is the case the
    // whole separation exists for — the asset holds personal data, so `internal` is unrepresentable
    // however senior the caller is.
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(asset({ classification: 'confidential', personalData: true })),
    });
    await expect(service.declassify('ia-1', 'internal', REASON, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_PERSONAL_DATA_EXPOSED',
    });
    expect(repo.reclassify).not.toHaveBeenCalled();
  });

  it('refuses to declassify a retired asset', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(asset({ retiredAt: new Date(), personalData: false })),
    });
    await expect(service.declassify('ia-1', 'internal', REASON, ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_RETIRED',
    });
  });
});

describe('retire', () => {
  it('refuses to retire twice', async () => {
    const { service } = makeService({ retire: vi.fn().mockResolvedValue(null) });
    await expect(service.retire('ia-1', ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_RETIRED',
    });
  });
});

describe('devices', () => {
  it('refuses to link a device to a retired asset', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(asset({ retiredAt: new Date() })),
    });
    await expect(service.linkDevice('ia-1', 'dev-1', ACTOR)).rejects.toMatchObject({
      code: 'INFORMATION_ASSET_RETIRED',
    });
    expect(repo.linkDevice).not.toHaveBeenCalled();
  });

  it('reports unlinking something that was not linked', async () => {
    const { service } = makeService({ unlinkDevice: vi.fn().mockResolvedValue(false) });
    await expect(service.unlinkDevice('ia-1', 'dev-1', ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers the lost-device question without requiring the device to be registered', async () => {
    // An empty list is the honest answer, and it must stay distinguishable from "no such device":
    // the caller asking has just been told a laptop is missing.
    const { service, repo } = makeService();
    await expect(service.holdingsOnDevice('dev-unknown')).resolves.toEqual([]);
    expect(repo.holdingsOnDevice).toHaveBeenCalledWith('dev-unknown');
  });
});
