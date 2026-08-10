/**
 * VendorService — the go-live preconditions, the lifecycle map, and the computed review date.
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `isms-vendors.e2e.spec.ts` drives the real API, the
 * CHECKs and the report SQL. What it cannot reach cheaply is the ORDER and the ARGUMENTS: that the
 * assessment is consulted BEFORE any write, that the review interval comes from the tiers table
 * rather than from anything hard-coded here, that the due date is computed from the same timestamp
 * the assessment recorded, and that a lost race is reported rather than papered over.
 *
 * The repository, the transaction and the audit are stubs, so what is under test is this service's
 * decisions.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { AUDIT_ACTION } from '@modules/audit';
import { ALLOWED_TRANSITIONS, PASSING_OUTCOMES, VendorService } from './vendor.service';
import type {
  Vendor,
  VendorAssessment,
  VendorCriticalityLevel,
  VendorStatus,
} from '../domain/vendor.types';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };
const REASON = 'They failed to remediate the findings from the last assessment.';
const SCOPE = 'Reviewed their SOC 2 Type II report and completed the security questionnaire.';

/**
 * The tiers, DELIBERATELY out of rank order and with non-contiguous ranks and distinctive intervals.
 *
 * If the service ever inferred the ordering from the array or the enum, or hard-coded a cadence,
 * these values would disagree with it. The stub is arranged so that guessing cannot pass.
 */
function levels(): VendorCriticalityLevel[] {
  const base = { label: 'x', description: 'x', createdAt: new Date(), updatedAt: new Date() };
  return [
    {
      code: 'high',
      rank: 30,
      reviewIntervalMonths: 12,
      requiresIndependentEvidence: true,
      ...base,
    },
    {
      code: 'low',
      rank: 10,
      reviewIntervalMonths: 36,
      requiresIndependentEvidence: false,
      ...base,
    },
    {
      code: 'critical',
      rank: 40,
      reviewIntervalMonths: 6,
      requiresIndependentEvidence: true,
      ...base,
    },
    {
      code: 'medium',
      rank: 20,
      reviewIntervalMonths: 24,
      requiresIndependentEvidence: false,
      ...base,
    },
  ];
}

function vendor(over: Partial<Vendor> = {}): Vendor {
  return {
    id: 'ven-1',
    reference: 'VEN-014',
    name: 'Acme Payroll',
    legalName: 'Acme Payroll Services Ltd',
    services: 'Runs monthly payroll and holds salary and bank details for all staff.',
    criticality: 'critical',
    status: 'prospective',
    ownerId: 'owner-1',
    dataProcessor: false,
    dataProcessingAgreementId: null,
    dataLocation: 'eu-west-1',
    contractStartsOn: null,
    contractEndsOn: null,
    noticePeriodDays: 90,
    reviewDueOn: null,
    terminatedAt: null,
    terminationReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function assessment(over: Partial<VendorAssessment> = {}): VendorAssessment {
  return {
    id: 'vas-1',
    vendorId: 'ven-1',
    assessedAt: new Date('2026-03-01T00:00:00.000Z'),
    assessedBy: ACTOR.sub,
    outcome: 'pass',
    scope: SCOPE,
    findings: null,
    conditions: null,
    evidenceDocumentId: null,
    createdAt: new Date(),
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}) {
  const repo = {
    listLevels: vi.fn().mockResolvedValue(levels()),
    create: vi.fn().mockResolvedValue(vendor()),
    findById: vi.fn().mockResolvedValue(vendor()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi
      .fn()
      .mockImplementation((id: string, input: Partial<Vendor>) =>
        Promise.resolve(vendor({ id, ...input })),
      ),
    transition: vi
      .fn()
      .mockImplementation((id: string, _f: string, to: VendorStatus, extra: Partial<Vendor>) =>
        Promise.resolve(vendor({ id, status: to, ...extra })),
      ),
    setReviewDueOn: vi.fn().mockResolvedValue(vendor()),
    appendAssessment: vi
      .fn()
      .mockImplementation((vendorId: string, input: Record<string, unknown>) =>
        Promise.resolve(assessment({ vendorId, ...(input as Partial<VendorAssessment>) })),
      ),
    listAssessments: vi.fn().mockResolvedValue([]),
    latestAssessment: vi.fn().mockResolvedValue(assessment()),
    linkRisk: vi.fn().mockResolvedValue(undefined),
    unlinkRisk: vi.fn().mockResolvedValue(true),
    listRisksFor: vi.fn().mockResolvedValue([]),
    reviewGaps: vi.fn().mockResolvedValue([]),
    criticalWithoutRisk: vi.fn().mockResolvedValue([]),
    unassessedSpend: vi.fn().mockResolvedValue([]),
    ...over,
  };
  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new VendorService(repo, db, audit as never);
  return { service, repo, transaction, audit, TX };
}

const REGISTER = {
  reference: 'VEN-014',
  name: 'Acme Payroll',
  services: 'Runs monthly payroll and holds salary and bank details for all staff.',
  criticality: 'critical' as const,
  ownerId: 'owner-1',
};

describe('the declared lifecycle', () => {
  it('makes termination terminal by construction', () => {
    // The map IS the specification, so this asserts the specification rather than a branch.
    expect(ALLOWED_TRANSITIONS.terminated).toEqual([]);
  });

  it('treats a conditional pass as permitting reliance', () => {
    // Deliberate: the conditions are recorded and tracked, and refusing to go live on a conditional
    // pass is how people learn to record an unconditional one instead.
    expect(PASSING_OUTCOMES).toContain('pass_with_conditions');
    expect(PASSING_OUTCOMES).not.toContain('fail');
  });
});

describe('register', () => {
  it('refuses a reference already in the register', async () => {
    const { service, repo } = makeService({ findByReference: vi.fn().mockResolvedValue(vendor()) });
    await expect(service.register(REGISTER, ACTOR)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a contract window that runs backwards', async () => {
    const { service, repo } = makeService();
    await expect(
      service.register(
        { ...REGISTER, contractStartsOn: '2027-01-01', contractEndsOn: '2026-01-01' },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'VENDOR_INVALID_CONTRACT_WINDOW' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('registers as prospective, not live', async () => {
    // Going live is a separate act with its own permission. If registration created an `active`
    // vendor, the assessment requirement would be bypassable by anybody holding `vendor.manage`.
    const { service, repo } = makeService();
    const registered = await service.register(REGISTER, ACTOR);
    expect(registered.status).toBe('prospective');
    expect(repo.transition).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('refuses a vendor nobody has ever assessed', async () => {
    const { service, repo } = makeService({ latestAssessment: vi.fn().mockResolvedValue(null) });
    await expect(service.activate('ven-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_ASSESSMENT_REQUIRED',
    });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('refuses when the most recent assessment failed', async () => {
    // The LATEST assessment decides. An old pass followed by a fail must not let them through, which
    // is why the service reads one row rather than asking whether any pass exists.
    const { service, repo } = makeService({
      latestAssessment: vi
        .fn()
        .mockResolvedValue(assessment({ outcome: 'fail', findings: 'Unpatched public host.' })),
    });
    await expect(service.activate('ven-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_ASSESSMENT_REQUIRED',
    });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('accepts a conditional pass', async () => {
    const { service } = makeService({
      latestAssessment: vi
        .fn()
        .mockResolvedValue(
          assessment({ outcome: 'pass_with_conditions', conditions: 'Enable MFA by 30 June.' }),
        ),
    });
    await expect(service.activate('ven-1', ACTOR)).resolves.toMatchObject({ status: 'active' });
  });

  it('refuses a data processor with no recorded agreement', async () => {
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(vendor({ dataProcessor: true, dataProcessingAgreementId: null })),
    });
    await expect(service.activate('ven-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_AGREEMENT_REQUIRED',
    });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('allows a data processor once the agreement is recorded', async () => {
    const { service } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(vendor({ dataProcessor: true, dataProcessingAgreementId: 'doc-1' })),
    });
    await expect(service.activate('ven-1', ACTOR)).resolves.toMatchObject({ status: 'active' });
  });

  it('refuses to activate a terminated vendor, and says the state is terminal', async () => {
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'terminated', terminatedAt: new Date(), terminationReason: REASON }),
        ),
    });
    await expect(service.activate('ven-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_NOT_IN_STATE',
    });
    // And it refuses BEFORE consulting the assessment: an illegal transition is not worth a query.
    expect(repo.latestAssessment).not.toHaveBeenCalled();
  });

  it('reports a lost race rather than recording an approval that did not happen', async () => {
    const { service } = makeService({ transition: vi.fn().mockResolvedValue(null) });
    await expect(service.activate('ven-1', ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits going live as its own action', async () => {
    const { service, audit } = makeService();
    await service.activate('ven-1', ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.VENDOR_ACTIVATED }),
      expect.anything(),
    );
  });
});

describe('reinstate', () => {
  it('re-checks the assessment rather than flipping the status back', async () => {
    // Whatever caused the suspension is exactly the reason to look again.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ status: 'suspended' })),
      latestAssessment: vi
        .fn()
        .mockResolvedValue(assessment({ outcome: 'fail', findings: 'Still unpatched.' })),
    });
    await expect(service.reinstate('ven-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_ASSESSMENT_REQUIRED',
    });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('returns a suspended vendor to active on a passing assessment', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ status: 'suspended' })),
    });
    await expect(service.reinstate('ven-1', ACTOR)).resolves.toMatchObject({ status: 'active' });
  });
});

describe('terminate', () => {
  it('sets the date and the reason together', async () => {
    // `ck_vendor_terminated_pair` and `ck_vendor_termination_reason` are both satisfied here rather
    // than left to the caller, so the pair cannot be half-written.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ status: 'active' })),
    });
    const result = await service.terminate('ven-1', REASON, ACTOR);
    // Asserted on the RESULT for the date — `expect.any(Date)` inside a matcher is an `any`
    // assignment, and the returned row proves the same thing: both halves of the pair were set by
    // the service rather than left to the caller.
    expect(result.terminatedAt).toBeInstanceOf(Date);
    expect(result.terminationReason).toBe(REASON);
    expect(repo.transition).toHaveBeenCalledWith(
      'ven-1',
      'active',
      'terminated',
      expect.objectContaining({ terminationReason: REASON }),
      expect.anything(),
    );
  });

  it('refuses to terminate twice', async () => {
    const { service } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'terminated', terminatedAt: new Date(), terminationReason: REASON }),
        ),
    });
    await expect(service.terminate('ven-1', REASON, ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_NOT_IN_STATE',
    });
  });
});

describe('assess', () => {
  it('reads the interval from the tiers table rather than assuming one', async () => {
    const { service, repo } = makeService();
    await service.assess('ven-1', { outcome: 'pass', scope: SCOPE }, ACTOR);
    // Asserting the CALL is the point: a service that never asked must be hard-coding the cadence.
    expect(repo.listLevels).toHaveBeenCalled();
  });

  it('moves the review date using the assessment timestamp and the tier interval', async () => {
    const { service, repo } = makeService();
    const assessedAt = '2026-03-01T09:00:00.000Z';
    await service.assess('ven-1', { outcome: 'pass', scope: SCOPE, assessedAt }, ACTOR);
    // The vendor is `critical`, which the stub gives a 6-month interval. Passing the inputs rather
    // than a computed date is what keeps ONE definition of the due date, in SQL.
    expect(repo.setReviewDueOn).toHaveBeenCalledWith(
      'ven-1',
      new Date(assessedAt),
      6,
      expect.anything(),
    );
  });

  it('uses the interval of the vendor own tier, not a default', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ criticality: 'low' })),
    });
    await service.assess('ven-1', { outcome: 'pass', scope: SCOPE }, ACTOR);
    expect(repo.setReviewDueOn).toHaveBeenCalledWith(
      'ven-1',
      expect.any(Date),
      36,
      expect.anything(),
    );
  });

  it('records the assessment and moves the clock in one transaction', async () => {
    // An assessment that does not reset the clock leaves the supplier permanently overdue; a clock
    // reset with no assessment behind it is what the cadence exists to prevent.
    const { service, repo, TX } = makeService();
    await service.assess('ven-1', { outcome: 'pass', scope: SCOPE }, ACTOR);
    expect(repo.appendAssessment).toHaveBeenCalledWith('ven-1', expect.anything(), TX);
    expect(repo.setReviewDueOn).toHaveBeenCalledWith('ven-1', expect.any(Date), 6, TX);
  });

  it('stamps the assessor from the token', async () => {
    const { service, repo } = makeService();
    await service.assess('ven-1', { outcome: 'pass', scope: SCOPE }, ACTOR);
    expect(repo.appendAssessment).toHaveBeenCalledWith(
      'ven-1',
      expect.objectContaining({ assessedBy: ACTOR.sub }),
      expect.anything(),
    );
  });

  it('refuses a conditional pass with no conditions', async () => {
    const { service, repo } = makeService();
    await expect(
      service.assess('ven-1', { outcome: 'pass_with_conditions', scope: SCOPE }, ACTOR),
    ).rejects.toMatchObject({ code: 'VENDOR_ASSESSMENT_INCOMPLETE' });
    expect(repo.appendAssessment).not.toHaveBeenCalled();
  });

  it('refuses a conditional pass whose conditions are a placeholder', async () => {
    // `n/a` occupies the space where the justification should be, which is worse than an empty one.
    const { service } = makeService();
    await expect(
      service.assess(
        'ven-1',
        { outcome: 'pass_with_conditions', scope: SCOPE, conditions: 'n/a' },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'VENDOR_ASSESSMENT_INCOMPLETE' });
  });

  it('refuses a failure with no findings', async () => {
    const { service } = makeService();
    await expect(
      service.assess('ven-1', { outcome: 'fail', scope: SCOPE }, ACTOR),
    ).rejects.toMatchObject({ code: 'VENDOR_ASSESSMENT_INCOMPLETE' });
  });

  it('refuses to assess a terminated vendor', async () => {
    const { service } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'terminated', terminatedAt: new Date(), terminationReason: REASON }),
        ),
    });
    await expect(
      service.assess('ven-1', { outcome: 'pass', scope: SCOPE }, ACTOR),
    ).rejects.toMatchObject({ code: 'VENDOR_TERMINATED' });
  });
});

describe('update', () => {
  it('refuses to clear the agreement of an active processor', async () => {
    // Reachable by clearing the document from an already-live processor, which is why the rule is
    // checked against the merged row rather than against the patch alone.
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'active', dataProcessor: true, dataProcessingAgreementId: 'doc-1' }),
        ),
    });
    await expect(
      service.update('ven-1', { dataProcessingAgreementId: null }, ACTOR),
    ).rejects.toMatchObject({ code: 'VENDOR_AGREEMENT_REQUIRED' });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to make an active vendor a processor without an agreement', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ status: 'active', dataProcessor: false })),
    });
    await expect(service.update('ven-1', { dataProcessor: true }, ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_AGREEMENT_REQUIRED',
    });
  });

  it('allows a prospective vendor to be a processor before the agreement exists', async () => {
    // The normal order of events. A blanket requirement would push this record-keeping outside the
    // system, which is worse than recording it early.
    const { service } = makeService({ findById: vi.fn().mockResolvedValue(vendor()) });
    await expect(service.update('ven-1', { dataProcessor: true }, ACTOR)).resolves.toMatchObject({
      dataProcessor: true,
    });
  });

  it('judges the contract window against the end already stored', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(vendor({ contractEndsOn: '2026-06-30' })),
    });
    await expect(
      service.update('ven-1', { contractStartsOn: '2027-01-01' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VENDOR_INVALID_CONTRACT_WINDOW' });
  });

  it('refuses any change to a terminated vendor', async () => {
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'terminated', terminatedAt: new Date(), terminationReason: REASON }),
        ),
    });
    await expect(service.update('ven-1', { name: 'Renamed' }, ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_TERMINATED',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('risk links', () => {
  it('refuses to link a risk to a terminated vendor', async () => {
    const { service, repo } = makeService({
      findById: vi
        .fn()
        .mockResolvedValue(
          vendor({ status: 'terminated', terminatedAt: new Date(), terminationReason: REASON }),
        ),
    });
    await expect(service.linkRisk('ven-1', 'risk-1', ACTOR)).rejects.toMatchObject({
      code: 'VENDOR_TERMINATED',
    });
    expect(repo.linkRisk).not.toHaveBeenCalled();
  });

  it('reports unlinking something that was not linked', async () => {
    const { service } = makeService({ unlinkRisk: vi.fn().mockResolvedValue(false) });
    await expect(service.unlinkRisk('ven-1', 'risk-1', ACTOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
