/**
 * NonconformanceService and CapaService — the closure gate, the review loop, and separation of duties.
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `qms-nonconformance.e2e.spec.ts` drives the real API and
 * the CHECKs. What it cannot reach cheaply is the ORDER and the ARGUMENTS: that the closure gate reads
 * `requiresCapa` from the severities table rather than from a list in the service, that it refuses
 * BEFORE any write, that a failed effectiveness review returns the CAPA to `analysis` rather than
 * closing it, and that a lost race is reported rather than papered over.
 *
 * Both services are exercised in one file because the rule that matters spans them: the gate is a
 * statement about CAPA rows, and testing it with a stub that always agrees would test nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { AUDIT_ACTION } from '@modules/audit';
import { createFakeAudit } from '../../../audit/src/testing/audit.fake';
import { CAPA_TRANSITIONS, CapaService } from './capa.service';
import { NONCONFORMANCE_TRANSITIONS, NonconformanceService } from './nonconformance.service';
import type {
  Capa,
  CapaStatus,
  Nonconformance,
  NonconformanceSeverityLevel,
  NonconformanceStatus,
} from '../domain/qms.types';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };
const OTHER = { sub: 'reviewer-1', email: 'reviewer@opshub.local' };
const NOTE = 'Re-audited ten releases and every one carried two approvals.';
const CAUSE = 'The pipeline accepted a single approver because the branch rule was advisory.';
const PLAN = 'Make the branch rule blocking and add a pipeline gate that fails on one approval.';

/**
 * The grades, DELIBERATELY out of rank order with non-contiguous ranks.
 *
 * `minor` does NOT require a CAPA and `major` does — which is the only thing the gate should consult.
 * If the service ever hard-coded either the ordering or the policy, these values would disagree.
 */
function severities(): NonconformanceSeverityLevel[] {
  const base = { label: 'x', description: 'x', createdAt: new Date(), updatedAt: new Date() };
  return [
    { code: 'major', rank: 30, requiresCapa: true, containmentDueDays: 7, ...base },
    { code: 'observation', rank: 10, requiresCapa: false, containmentDueDays: 30, ...base },
    { code: 'critical', rank: 40, requiresCapa: true, containmentDueDays: 1, ...base },
    { code: 'minor', rank: 20, requiresCapa: false, containmentDueDays: 14, ...base },
  ];
}

function finding(over: Partial<Nonconformance> = {}): Nonconformance {
  return {
    id: 'nc-1',
    reference: 'NC-2026-014',
    title: 'Two approvals required, one recorded',
    description: 'The release was approved by one person where the procedure requires two.',
    requirement: 'SOP-12 section 4 requires two approvals before release.',
    source: 'internal_audit',
    severity: 'major',
    status: 'open',
    processArea: 'release management',
    ownerId: 'owner-1',
    detectedAt: new Date('2026-03-01T00:00:00.000Z'),
    raisedBy: 'reporter-1',
    incidentId: null,
    evidenceDocumentId: null,
    internalAuditId: null,
    containmentAction: null,
    containedAt: null,
    closedAt: null,
    closureNote: null,
    closedBy: null,
    voidReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/**
 * A finding that has been contained — the only state closure is legal from.
 *
 * `open → closed` is refused by `ALLOWED_TRANSITIONS` and by `ck_nc_contained_states`: ISO 9001
 * §10.2(a) requires reacting to the nonconformity, so closing with nothing recorded in between is
 * what the rule exists to prevent.
 */
function contained(over: Partial<Nonconformance> = {}): Nonconformance {
  return finding({
    status: 'contained',
    containedAt: new Date('2026-03-02T00:00:00.000Z'),
    containmentAction: 'We re-ran the approval with two signatories.',
    ...over,
  });
}

function capa(over: Partial<Capa> = {}): Capa {
  return {
    id: 'capa-1',
    reference: 'CAPA-2026-007',
    nonconformanceId: 'nc-1',
    status: 'analysis',
    ownerId: 'owner-1',
    rootCause: null,
    rootCauseMethod: null,
    actionPlan: null,
    dueOn: null,
    implementedAt: null,
    verifiedAt: null,
    verifiedBy: null,
    effectivenessEvidence: null,
    outcomeNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeServices(
  over: {
    nc?: Record<string, unknown>;
    capa?: Record<string, unknown>;
    audits?: Record<string, unknown>;
  } = {},
) {
  const ncRepo = {
    listSeverities: vi.fn().mockResolvedValue(severities()),
    create: vi.fn().mockResolvedValue(finding()),
    findById: vi.fn().mockResolvedValue(finding()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi
      .fn()
      .mockImplementation((id: string, input: Partial<Nonconformance>) =>
        Promise.resolve(finding({ id, ...input })),
      ),
    transition: vi
      .fn()
      .mockImplementation(
        (id: string, _f: string, to: NonconformanceStatus, extra: Partial<Nonconformance>) =>
          Promise.resolve(finding({ id, status: to, ...extra })),
      ),
    containmentOverdue: vi.fn().mockResolvedValue([]),
    recurrenceSignals: vi.fn().mockResolvedValue([]),
    ...over.nc,
  };
  const capaRepo = {
    create: vi.fn().mockResolvedValue(capa()),
    findById: vi.fn().mockResolvedValue(capa()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    listForNonconformance: vi.fn().mockResolvedValue([]),
    setAnalysis: vi
      .fn()
      .mockImplementation((id: string, input: Partial<Capa>) =>
        Promise.resolve(capa({ id, ...input })),
      ),
    transition: vi
      .fn()
      .mockImplementation((id: string, _f: string, to: CapaStatus, extra: Partial<Capa>) =>
        Promise.resolve(capa({ id, status: to, ...extra })),
      ),
    hasVerifiedCapa: vi.fn().mockResolvedValue(false),
    ...over.capa,
  };
  /**
   * The audit roster, stubbed so the impartiality rule has something to ask.
   *
   * `didAudit` defaults to FALSE and `findById` returns a finding with no audit linked, so the rule is
   * inert unless a test opts in. That keeps the twenty-odd tests that predate §9.2 saying what they
   * always said, and makes the impartiality tests state their own setup.
   */
  const auditRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi.fn(),
    transition: vi.fn(),
    upsertAuditor: vi.fn().mockResolvedValue(undefined),
    removeAuditor: vi.fn().mockResolvedValue(true),
    listAuditors: vi.fn().mockResolvedValue([]),
    didAudit: vi.fn().mockResolvedValue(false),
    listFindings: vi.fn().mockResolvedValue([]),
    unlinkedFindings: vi.fn().mockResolvedValue([]),
    ...over.audits,
  };
  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = createFakeAudit();

  return {
    nc: new NonconformanceService(ncRepo, capaRepo, db, audit as never),
    capa: new CapaService(capaRepo, ncRepo, auditRepo, db, audit as never),
    ncRepo,
    capaRepo,
    auditRepo,
    audit,
    TX,
  };
}

describe('the declared lifecycles', () => {
  it('refuses to close a finding straight from open', () => {
    // ISO 9001 §10.2(a) requires reacting to the nonconformity. A finding that goes from "found" to
    // "closed" with nothing recorded in between is the box-ticking the clause exists to prevent —
    // and `ck_nc_contained_states` enforces the same thing in the database.
    expect(NONCONFORMANCE_TRANSITIONS.open).not.toContain('closed');
    expect(NONCONFORMANCE_TRANSITIONS.contained).toContain('closed');
  });

  it('makes closed and void terminal', () => {
    expect(NONCONFORMANCE_TRANSITIONS.closed).toEqual([]);
    expect(NONCONFORMANCE_TRANSITIONS.void).toEqual([]);
  });

  it('returns a failed effectiveness review to analysis', () => {
    // The specification, asserted as a table rather than by tracing branches. A review that can only
    // pass is not a review.
    expect(CAPA_TRANSITIONS.implemented).toContain('ineffective');
    expect(CAPA_TRANSITIONS.ineffective).toContain('analysis');
  });

  it('makes a verified CAPA terminal', () => {
    // Revisiting after sign-off is a NEW CAPA: re-opening would overwrite the evidence somebody
    // relied on.
    expect(CAPA_TRANSITIONS.verified).toEqual([]);
  });
});

describe('the closure gate', () => {
  it('refuses to close a grade that requires a CAPA when none is verified', async () => {
    const { nc, ncRepo, capaRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(contained()) },
    });
    await expect(nc.close('nc-1', NOTE, ACTOR)).rejects.toMatchObject({
      code: 'NONCONFORMANCE_CAPA_REQUIRED',
    });
    expect(capaRepo.hasVerifiedCapa).toHaveBeenCalledWith('nc-1');
    expect(ncRepo.transition).not.toHaveBeenCalled();
  });

  it('closes the same finding once a CAPA is verified', async () => {
    const { nc } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(contained()) },
      capa: { hasVerifiedCapa: vi.fn().mockResolvedValue(true) },
    });
    await expect(nc.close('nc-1', NOTE, ACTOR)).resolves.toMatchObject({ status: 'closed' });
  });

  it('closes a grade that does not require one without consulting CAPAs', async () => {
    const { nc, capaRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(contained({ severity: 'minor' })) },
    });
    await expect(nc.close('nc-1', NOTE, ACTOR)).resolves.toMatchObject({ status: 'closed' });
    expect(capaRepo.hasVerifiedCapa).not.toHaveBeenCalled();
  });

  it('reads the requirement from the severities table rather than assuming it', async () => {
    // The stub's ranks are non-contiguous and out of order, and `minor` deliberately requires no
    // CAPA. Asserting the CALL is the point: a service that never asked is hard-coding the policy.
    const { nc, ncRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(contained()) },
    });
    await expect(nc.close('nc-1', NOTE, ACTOR)).rejects.toMatchObject({
      code: 'NONCONFORMANCE_CAPA_REQUIRED',
    });
    expect(ncRepo.listSeverities).toHaveBeenCalled();
  });

  it('stamps the closer from the token', async () => {
    const { nc, ncRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(contained()) },
      capa: { hasVerifiedCapa: vi.fn().mockResolvedValue(true) },
    });
    await nc.close('nc-1', NOTE, ACTOR);
    expect(ncRepo.transition).toHaveBeenCalledWith(
      'nc-1',
      'contained',
      'closed',
      expect.objectContaining({ closedBy: ACTOR.sub, closureNote: NOTE }),
      expect.anything(),
    );
  });

  it('reports a lost race rather than recording a closure that did not happen', async () => {
    const { nc } = makeServices({
      nc: {
        findById: vi.fn().mockResolvedValue(contained()),
        transition: vi.fn().mockResolvedValue(null),
      },
      capa: { hasVerifiedCapa: vi.fn().mockResolvedValue(true) },
    });
    await expect(nc.close('nc-1', NOTE, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('raising and containing', () => {
  it('refuses a duplicate reference', async () => {
    const { nc, ncRepo } = makeServices({
      nc: { findByReference: vi.fn().mockResolvedValue(finding()) },
    });
    await expect(
      nc.raise(
        {
          reference: 'NC-2026-014',
          title: 'A title',
          description: 'A description long enough',
          requirement: 'SOP-1',
          source: 'other',
          severity: 'minor',
          processArea: 'area',
          ownerId: 'owner-1',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ncRepo.create).not.toHaveBeenCalled();
  });

  it('takes the raiser from the token, not the payload', async () => {
    const { nc, ncRepo, TX } = makeServices();
    await nc.raise(
      {
        reference: 'NC-1',
        title: 'A title',
        description: 'A description long enough',
        requirement: 'SOP-1',
        source: 'other',
        severity: 'minor',
        processArea: 'area',
        ownerId: 'owner-1',
      },
      ACTOR,
    );
    expect(ncRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ raisedBy: ACTOR.sub }),
      TX,
    );
  });

  it('refuses a detection date in the future', async () => {
    const { nc } = makeServices();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      nc.raise(
        {
          reference: 'NC-1',
          title: 'A title',
          description: 'A description long enough',
          requirement: 'SOP-1',
          source: 'other',
          severity: 'minor',
          processArea: 'area',
          ownerId: 'owner-1',
          detectedAt: tomorrow,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'NONCONFORMANCE_NOT_IN_STATE' });
  });

  it('refuses containment dated before detection', async () => {
    const { nc, ncRepo } = makeServices();
    await expect(
      nc.contain(
        'nc-1',
        'We re-ran the approval with two signatories.',
        '2020-01-01T00:00:00.000Z',
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'NONCONFORMANCE_NOT_IN_STATE' });
    expect(ncRepo.transition).not.toHaveBeenCalled();
  });

  it('refuses to void a finding that has been contained', async () => {
    // Containing something is saying it was real.
    const { nc, ncRepo } = makeServices({
      nc: {
        findById: vi
          .fn()
          .mockResolvedValue(finding({ containedAt: new Date(), containmentAction: 'Done.' })),
      },
    });
    await expect(
      nc.void('nc-1', 'Raised against the wrong procedure.', ACTOR),
    ).rejects.toMatchObject({
      code: 'NONCONFORMANCE_NOT_IN_STATE',
    });
    expect(ncRepo.transition).not.toHaveBeenCalled();
  });

  it('refuses any edit to a settled finding', async () => {
    const { nc, ncRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(finding({ status: 'closed' })) },
    });
    await expect(nc.update('nc-1', { severity: 'minor' }, ACTOR)).rejects.toMatchObject({
      code: 'NONCONFORMANCE_SETTLED',
    });
    expect(ncRepo.update).not.toHaveBeenCalled();
  });
});

describe('CAPA analysis and planning', () => {
  it('refuses to open one against a settled finding', async () => {
    const { capa: service, capaRepo } = makeServices({
      nc: { findById: vi.fn().mockResolvedValue(finding({ status: 'closed' })) },
    });
    await expect(
      service.open('nc-1', { reference: 'CAPA-1', ownerId: 'owner-1' }, ACTOR),
    ).rejects.toMatchObject({ code: 'NONCONFORMANCE_SETTLED' });
    expect(capaRepo.create).not.toHaveBeenCalled();
  });

  it('refuses to plan without a root cause, and names what is missing', async () => {
    const { capa: service, capaRepo } = makeServices();
    await expect(service.plan('capa-1', ACTOR)).rejects.toMatchObject({
      code: 'CAPA_ANALYSIS_INCOMPLETE',
    });
    expect(capaRepo.transition).not.toHaveBeenCalled();
  });

  it('refuses to plan with a cause but no method behind it', async () => {
    // A cause with no method is an assertion.
    const { capa: service } = makeServices({
      capa: {
        findById: vi.fn().mockResolvedValue(capa({ rootCause: CAUSE, actionPlan: PLAN })),
      },
    });
    await expect(service.plan('capa-1', ACTOR)).rejects.toMatchObject({
      code: 'CAPA_ANALYSIS_INCOMPLETE',
    });
  });

  it('plans once the analysis is complete', async () => {
    const { capa: service } = makeServices({
      capa: {
        findById: vi
          .fn()
          .mockResolvedValue(
            capa({ rootCause: CAUSE, rootCauseMethod: 'five_whys', actionPlan: PLAN }),
          ),
      },
    });
    await expect(service.plan('capa-1', ACTOR)).resolves.toMatchObject({ status: 'planned' });
  });

  it('accepts a new analysis only while in analysis', async () => {
    const { capa: service, capaRepo } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(capa({ status: 'in_progress' })) },
    });
    await expect(
      service.recordAnalysis(
        'capa-1',
        { rootCause: CAUSE, rootCauseMethod: 'five_whys', actionPlan: PLAN },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CAPA_NOT_IN_STATE' });
    expect(capaRepo.setAnalysis).not.toHaveBeenCalled();
  });
});

describe('the effectiveness review', () => {
  const implemented = () =>
    capa({
      status: 'implemented',
      rootCause: CAUSE,
      rootCauseMethod: 'five_whys',
      actionPlan: PLAN,
      implementedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

  it('refuses a verifier who owns the CAPA', async () => {
    // The permission says who MAY sign; this is what makes the signature a review.
    const { capa: service, capaRepo } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
    });
    await expect(
      service.verify('capa-1', NOTE, { sub: 'owner-1', email: 'owner@opshub.local' }),
    ).rejects.toMatchObject({ code: 'CAPA_SELF_VERIFICATION' });
    expect(capaRepo.transition).not.toHaveBeenCalled();
  });

  it('refuses the owner in the FAILING direction too', async () => {
    // A review only counts if the author cannot decide the answer either way.
    const { capa: service } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
    });
    await expect(
      service.markIneffective('capa-1', NOTE, { sub: 'owner-1', email: 'owner@opshub.local' }),
    ).rejects.toMatchObject({ code: 'CAPA_SELF_VERIFICATION' });
  });

  it('records the verifier and the evidence from the actor', async () => {
    const { capa: service, capaRepo } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
    });
    await service.verify('capa-1', NOTE, OTHER);
    expect(capaRepo.transition).toHaveBeenCalledWith(
      'capa-1',
      'implemented',
      'verified',
      expect.objectContaining({ verifiedBy: OTHER.sub, effectivenessEvidence: NOTE }),
      expect.anything(),
    );
  });

  it('audits a failed review as its own action, not as a verification', async () => {
    // "Show me every corrective action that did not work" is the management-review question, so it
    // has to be a query over the trail.
    const { capa: service, audit } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
    });
    await service.markIneffective('capa-1', NOTE, OTHER);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.CAPA_INEFFECTIVE }),
      expect.anything(),
    );
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.CAPA_VERIFIED }),
      expect.anything(),
    );
  });

  it('refuses to verify a CAPA that was never implemented', async () => {
    const { capa: service } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(capa({ status: 'in_progress' })) },
    });
    await expect(service.verify('capa-1', NOTE, OTHER)).rejects.toMatchObject({
      code: 'CAPA_NOT_IN_STATE',
    });
  });

  it('refuses to verify twice', async () => {
    const { capa: service } = makeServices({
      capa: {
        findById: vi
          .fn()
          .mockResolvedValue(
            capa({ status: 'verified', verifiedBy: OTHER.sub, effectivenessEvidence: NOTE }),
          ),
      },
    });
    await expect(service.verify('capa-1', NOTE, OTHER)).rejects.toMatchObject({
      code: 'CAPA_NOT_IN_STATE',
    });
  });

  it('refuses somebody who AUDITED the finding, even holding the permission', async () => {
    // ISO 9001 §9.2.2(c). A different rule from self-verification: this reviewer owns nothing, they
    // simply found the problem, and certifying that your own finding was adequately fixed is exactly
    // the conflict the clause names.
    const {
      capa: service,
      capaRepo,
      auditRepo,
    } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
      nc: { findById: vi.fn().mockResolvedValue(finding({ internalAuditId: 'ia-1' })) },
      audits: { didAudit: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.verify('capa-1', NOTE, OTHER)).rejects.toMatchObject({
      code: 'CAPA_AUDITOR_IMPARTIALITY',
    });
    expect(auditRepo.didAudit).toHaveBeenCalledWith('ia-1', OTHER.sub);
    expect(capaRepo.transition).not.toHaveBeenCalled();
  });

  it('refuses the auditor in the FAILING direction too', async () => {
    // A review the auditor may fail but not pass is still the auditor deciding.
    const { capa: service } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
      nc: { findById: vi.fn().mockResolvedValue(finding({ internalAuditId: 'ia-1' })) },
      audits: { didAudit: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.markIneffective('capa-1', NOTE, OTHER)).rejects.toMatchObject({
      code: 'CAPA_AUDITOR_IMPARTIALITY',
    });
  });

  it('allows an observer on the audit to verify', async () => {
    // `didAudit` excludes observers, so sitting in to learn does not disqualify a later review. The
    // repository decides that; this pins that the service asks and believes the answer.
    const { capa: service } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
      nc: { findById: vi.fn().mockResolvedValue(finding({ internalAuditId: 'ia-1' })) },
      audits: { didAudit: vi.fn().mockResolvedValue(false) },
    });
    await expect(service.verify('capa-1', NOTE, OTHER)).resolves.toMatchObject({
      status: 'verified',
    });
  });

  it('does not consult the roster for a finding with no audit linked', async () => {
    // The traceability gap the unlinked-findings report exists for: an unrecorded link cannot be
    // enforced on, and refusing every review because a link is missing would punish the wrong person.
    const { capa: service, auditRepo } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(implemented()) },
      nc: { findById: vi.fn().mockResolvedValue(finding({ internalAuditId: null })) },
    });
    await expect(service.verify('capa-1', NOTE, OTHER)).resolves.toMatchObject({
      status: 'verified',
    });
    expect(auditRepo.didAudit).not.toHaveBeenCalled();
  });

  it('lets a failed CAPA return to analysis', async () => {
    const { capa: service } = makeServices({
      capa: { findById: vi.fn().mockResolvedValue(capa({ status: 'ineffective' })) },
    });
    await expect(service.reopenAnalysis('capa-1', ACTOR)).resolves.toMatchObject({
      status: 'analysis',
    });
  });
});
