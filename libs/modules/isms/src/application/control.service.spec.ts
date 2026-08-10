/**
 * ControlService — the SoA consistency rule, the retired-control refusals, and the whole-statement write.
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `isms-controls.e2e.spec.ts` drives the real API,
 * `ck_soa_applicability` and the coverage SQL. What it cannot reach cheaply is the ARGUMENT shape:
 * that the decision is passed to a single upsert rather than a read-then-branch, that a retired
 * control is refused BEFORE any write, and that the consistency rule is checked in both directions.
 *
 * The repositories and the transaction are stubs, so what is under test is this service's decisions.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { ControlService } from './control.service';
import type { Control, SetSoaEntryInput, SoaEntry } from '../domain/control.types';
import { createFakeAudit } from '../../../audit/src/testing/audit.fake';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };

function control(over: Partial<Control> = {}): Control {
  return {
    id: 'ctl-1',
    reference: 'A.5.1',
    title: 'Policies for information security',
    description: null,
    theme: 'organizational',
    source: 'annex_a',
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function entry(over: Partial<SoaEntry> = {}): SoaEntry {
  return {
    id: 'soa-1',
    controlId: 'ctl-1',
    applicable: true,
    justification: 'Required by the ISMS scope.',
    status: 'implemented',
    implementationNote: null,
    evidenceDocumentId: null,
    ownerId: null,
    lastReviewedAt: null,
    reviewDueOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** A consistent, valid decision — the baseline each test varies one field of. */
const INCLUDED: SetSoaEntryInput = {
  applicable: true,
  justification: 'Required by the ISMS scope and implemented via the policy library.',
  status: 'implemented',
};

function makeService(over: Record<string, unknown> = {}, riskOver: Record<string, unknown> = {}) {
  const repo = {
    createControl: vi.fn().mockResolvedValue(control()),
    findControlById: vi.fn().mockResolvedValue(control()),
    findControlByReference: vi.fn().mockResolvedValue(null),
    listControls: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateControl: vi
      .fn()
      .mockImplementation((id: string, input: Partial<Control>) =>
        Promise.resolve(control({ id, ...input })),
      ),
    retireControl: vi.fn().mockResolvedValue(control({ retiredAt: new Date() })),
    findEntryByControl: vi.fn().mockResolvedValue(null),
    upsertEntry: vi
      .fn()
      .mockImplementation((controlId: string, input: SetSoaEntryInput) =>
        Promise.resolve(entry({ controlId, ...input })),
      ),
    listEntries: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    markReviewed: vi.fn().mockResolvedValue(entry({ lastReviewedAt: new Date() })),
    linkRiskControl: vi.fn().mockResolvedValue(undefined),
    unlinkRiskControl: vi.fn().mockResolvedValue(true),
    listControlsForRisk: vi.fn().mockResolvedValue([]),
    listRisksForControl: vi.fn().mockResolvedValue([]),
    soaCoverage: vi.fn().mockResolvedValue({
      totalControls: 1,
      undecided: 0,
      applicable: 1,
      excluded: 0,
      implemented: 1,
      partiallyImplemented: 0,
      notImplemented: 0,
    }),
    untreatedRisks: vi.fn().mockResolvedValue([]),
    ...over,
  };
  const risks = {
    findById: vi.fn().mockResolvedValue({ id: 'risk-1', reference: 'RSK-1' }),
    ...riskOver,
  };
  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = createFakeAudit();

  const service = new ControlService(repo, risks as never, db, audit as never);
  return { service, repo, risks, transaction, audit, TX };
}

describe('createControl', () => {
  it('refuses a duplicate reference before writing anything', async () => {
    const { service, repo } = makeService({
      findControlByReference: vi.fn().mockResolvedValue(control()),
    });

    await expect(
      service.createControl({ reference: 'A.5.1', title: 'X', theme: 'organizational' }, ACTOR),
    ).rejects.toThrow(ConflictException);
    expect(repo.createControl).not.toHaveBeenCalled();
  });

  it('writes the audit entry inside the transaction', async () => {
    const { service, audit, TX } = makeService();

    await service.createControl({ reference: 'A.9.9', title: 'X', theme: 'people' }, ACTOR);

    expect(audit.record).toHaveBeenCalledWith(expect.anything(), TX);
  });
});

describe('setEntry — the consistency rule', () => {
  it('refuses an EXCLUDED control with any implementation status', async () => {
    const { service, repo } = makeService();

    for (const status of ['implemented', 'partially_implemented', 'not_implemented'] as const) {
      await expect(
        service.setEntry('ctl-1', { ...INCLUDED, applicable: false, status }, ACTOR),
      ).rejects.toMatchObject({ code: 'SOA_INCONSISTENT' });
    }
    // `ck_soa_applicability` would catch it, but as a 500 with no code.
    expect(repo.upsertEntry).not.toHaveBeenCalled();
  });

  it('refuses an APPLICABLE control marked not_applicable', async () => {
    const { service, repo } = makeService();

    await expect(
      service.setEntry('ctl-1', { ...INCLUDED, status: 'not_applicable' }, ACTOR),
    ).rejects.toMatchObject({ code: 'SOA_INCONSISTENT' });
    expect(repo.upsertEntry).not.toHaveBeenCalled();
  });

  it('accepts the two consistent combinations', async () => {
    const { service } = makeService();

    await expect(service.setEntry('ctl-1', INCLUDED, ACTOR)).resolves.toBeTruthy();
    await expect(
      service.setEntry(
        'ctl-1',
        {
          applicable: false,
          justification: 'Out of scope: no cloud services in use.',
          status: 'not_applicable',
        },
        ACTOR,
      ),
    ).resolves.toBeTruthy();
  });
});

describe('setEntry — the write', () => {
  it('refuses a retired control before writing', async () => {
    const { service, repo } = makeService({
      findControlById: vi.fn().mockResolvedValue(control({ retiredAt: new Date() })),
    });

    await expect(service.setEntry('ctl-1', INCLUDED, ACTOR)).rejects.toMatchObject({
      code: 'CONTROL_RETIRED',
    });
    expect(repo.upsertEntry).not.toHaveBeenCalled();
  });

  it('passes the WHOLE statement to a single upsert', async () => {
    // One statement, one write. A read-then-branch would let two concurrent writers both find
    // nothing and race on `uq_soa_control`.
    const { service, repo, TX } = makeService();

    await service.setEntry('ctl-1', INCLUDED, ACTOR);

    expect(repo.upsertEntry).toHaveBeenCalledTimes(1);
    expect(repo.upsertEntry).toHaveBeenCalledWith('ctl-1', INCLUDED, TX);
  });

  it('records the previous decision in the audit entry when one existed', async () => {
    const { service, audit } = makeService({
      findEntryByControl: vi
        .fn()
        .mockResolvedValue(entry({ applicable: false, status: 'not_applicable' })),
    });

    await service.setEntry('ctl-1', INCLUDED, ACTOR);

    const recorded = audit.record.mock.calls[0][0] as { changes: { before: unknown } };
    expect(recorded.changes.before).toEqual({ applicable: false, status: 'not_applicable' });
  });

  it('records a null before when the control had no decision yet', async () => {
    const { service, audit } = makeService();

    await service.setEntry('ctl-1', INCLUDED, ACTOR);

    const recorded = audit.record.mock.calls[0][0] as { changes: { before: unknown } };
    expect(recorded.changes.before).toBeNull();
  });
});

describe('getEntry', () => {
  it('404s when no decision has been recorded — a real state, not a lookup failure', async () => {
    const { service } = makeService();

    await expect(service.getEntry('ctl-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('retireControl', () => {
  it('reports an already-retired control rather than rewriting the date', async () => {
    const { service } = makeService({ retireControl: vi.fn().mockResolvedValue(null) });

    await expect(service.retireControl('ctl-1', ACTOR)).rejects.toMatchObject({
      code: 'CONTROL_RETIRED',
    });
  });
});

describe('linkRisk', () => {
  it('404s for an unknown risk before touching the control', async () => {
    const { service, repo } = makeService({}, { findById: vi.fn().mockResolvedValue(null) });

    await expect(service.linkRisk('nope', 'ctl-1', ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.findControlById).not.toHaveBeenCalled();
    expect(repo.linkRiskControl).not.toHaveBeenCalled();
  });

  it('refuses to assign a retired control to treat a risk', async () => {
    const { service, repo } = makeService({
      findControlById: vi.fn().mockResolvedValue(control({ retiredAt: new Date() })),
    });

    await expect(service.linkRisk('risk-1', 'ctl-1', ACTOR)).rejects.toMatchObject({
      code: 'CONTROL_RETIRED',
    });
    expect(repo.linkRiskControl).not.toHaveBeenCalled();
  });

  it('records who linked them', async () => {
    const { service, repo, TX } = makeService();

    await service.linkRisk('risk-1', 'ctl-1', ACTOR);

    expect(repo.linkRiskControl).toHaveBeenCalledWith('risk-1', 'ctl-1', ACTOR.sub, TX);
  });
});

describe('unlinkRisk', () => {
  it('404s when the pair was not linked', async () => {
    const { service } = makeService({ unlinkRiskControl: vi.fn().mockResolvedValue(false) });

    await expect(service.unlinkRisk('risk-1', 'ctl-1', ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('reports', () => {
  it('delegates coverage to SQL rather than counting here', async () => {
    // Counting in the service would mean paging the catalogue into memory to answer four
    // `count(*) FILTER` expressions.
    const { service, repo } = makeService();

    const coverage = await service.coverage();

    expect(repo.soaCoverage).toHaveBeenCalledTimes(1);
    expect(coverage.totalControls).toBe(1);
  });

  it('caps the untreated-risk report by default', async () => {
    const { service, repo } = makeService();

    await service.untreatedRisks();

    expect(repo.untreatedRisks).toHaveBeenCalledWith(200);
  });
});
