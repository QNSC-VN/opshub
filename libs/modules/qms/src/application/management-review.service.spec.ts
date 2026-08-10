/**
 * ManagementReviewService — the frozen snapshot, the ordering rule, and §9.3.2(a).
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `qms-management-review.e2e.spec.ts` drives the real API
 * and the CHECKs. What it cannot reach cheaply is the ORDER and the ARGUMENTS: that holding a review
 * COMPOSES the agenda and writes it in the same transition, that it refuses before any write when an
 * earlier review is outstanding, and that a review's own actions are excluded from the history it is
 * reviewing.
 *
 * The four registers it composes are stubs here, so what is under test is this service's decisions
 * rather than their queries.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { AUDIT_ACTION } from '@modules/audit';
import { createFakeAudit } from '../../../audit/src/testing/audit.fake';
import {
  MANAGEMENT_REVIEW_TRANSITIONS,
  ManagementReviewService,
} from './management-review.service';
import type {
  CarriedForwardAction,
  ManagementReview,
  ManagementReviewAction,
  ManagementReviewStatus,
  ReviewActionStatus,
} from '../domain/management-review.types';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };
const CONCLUSION = 'The QMS remains effective; three improvement actions were raised.';
const OUTCOME = 'Delivered in the July release and confirmed by a follow-up sample.';

function review(over: Partial<ManagementReview> = {}): ManagementReview {
  return {
    id: 'mr-1',
    reference: 'MR-2026-H1',
    title: 'Half-year management review',
    period: 'H1 2026',
    status: 'scheduled',
    chairId: 'chair-1',
    scheduledFor: '2026-07-01',
    heldOn: null,
    inputs: null,
    conclusion: null,
    minutesDocumentId: null,
    closedAt: null,
    cancelReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function action(over: Partial<ManagementReviewAction> = {}): ManagementReviewAction {
  return {
    id: 'mra-1',
    managementReviewId: 'mr-1',
    category: 'improvement',
    description: 'Add a second approver to the release checklist.',
    ownerId: 'owner-1',
    dueOn: null,
    status: 'open',
    completedAt: null,
    outcomeNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function carried(over: Partial<CarriedForwardAction> = {}): CarriedForwardAction {
  return {
    id: 'mra-old',
    reviewReference: 'MR-2025-H2',
    category: 'qms_change',
    description: 'Rewrite SOP-4 to name the approval control explicitly.',
    ownerId: 'owner-2',
    status: 'open',
    dueOn: '2026-01-31',
    daysOverdue: 180,
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(review()),
    findById: vi.fn().mockResolvedValue(review()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi
      .fn()
      .mockImplementation((id: string, input: Partial<ManagementReview>) =>
        Promise.resolve(review({ id, ...input })),
      ),
    transition: vi
      .fn()
      .mockImplementation(
        (id: string, _f: string, to: ManagementReviewStatus, extra: Partial<ManagementReview>) =>
          Promise.resolve(review({ id, status: to, ...extra })),
      ),
    earlierOutstanding: vi.fn().mockResolvedValue(null),
    addAction: vi.fn().mockResolvedValue(action()),
    findActionById: vi.fn().mockResolvedValue(action()),
    listActions: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    updateAction: vi
      .fn()
      .mockImplementation((id: string, input: Partial<ManagementReviewAction>) =>
        Promise.resolve(action({ id, ...input })),
      ),
    transitionAction: vi
      .fn()
      .mockImplementation(
        (id: string, _f: string, to: ReviewActionStatus, extra: Partial<ManagementReviewAction>) =>
          Promise.resolve(action({ id, status: to, ...extra })),
      ),
    carriedForward: vi.fn().mockResolvedValue([carried()]),
    ...over,
  };

  /** The four registers §9.3.2 draws on. Each returns one row, so a count of 1 proves it was asked. */
  const nonconformances = {
    containmentOverdue: vi.fn().mockResolvedValue([{ reference: 'NC-1' }]),
    recurrenceSignals: vi.fn().mockResolvedValue([{ processArea: 'purchasing' }]),
  };
  const audits = { unlinkedFindings: vi.fn().mockResolvedValue([{ reference: 'NC-2' }]) };
  const vendors = {
    reviewGaps: vi.fn().mockResolvedValue([{ reference: 'VEN-1' }]),
    criticalWithoutRisk: vi.fn().mockResolvedValue([{ reference: 'VEN-2' }]),
    unassessedSpend: vi.fn().mockResolvedValue([{ licenseId: 'lic-1' }]),
  };
  const controls = { untreatedRisks: vi.fn().mockResolvedValue([{ reference: 'RSK-1' }]) };

  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = createFakeAudit();

  const service = new ManagementReviewService(
    repo,
    nonconformances as never,
    audits as never,
    vendors as never,
    controls as never,
    db,
    audit as never,
  );
  return { service, repo, nonconformances, audits, vendors, controls, audit, TX };
}

describe('the declared lifecycle', () => {
  it('separates held from closed', () => {
    // §9.3.3 wants documented outputs, so a meeting whose minutes were never issued is not a
    // completed review.
    expect(MANAGEMENT_REVIEW_TRANSITIONS.scheduled).toContain('held');
    expect(MANAGEMENT_REVIEW_TRANSITIONS.held).toEqual(['closed']);
  });

  it('cannot cancel a review that has been held', () => {
    // Its inputs are frozen and its actions raised; none of that is cancellable.
    expect(MANAGEMENT_REVIEW_TRANSITIONS.held).not.toContain('cancelled');
    expect(MANAGEMENT_REVIEW_TRANSITIONS.scheduled).toContain('cancelled');
  });
});

describe('the agenda', () => {
  it('asks every register §9.3.2 names', async () => {
    // The clause is a list, and each item is another register's answer. Asserting the CALLS is the
    // point: a service that never asked is storing its own copy somewhere.
    const { service, repo, nonconformances, audits, vendors, controls } = makeService();
    const agenda = await service.assembleAgenda(null);

    expect(repo.carriedForward).toHaveBeenCalled();
    expect(nonconformances.containmentOverdue).toHaveBeenCalled();
    expect(nonconformances.recurrenceSignals).toHaveBeenCalled();
    expect(audits.unlinkedFindings).toHaveBeenCalled();
    expect(vendors.reviewGaps).toHaveBeenCalled();
    expect(vendors.criticalWithoutRisk).toHaveBeenCalled();
    expect(vendors.unassessedSpend).toHaveBeenCalled();
    expect(controls.untreatedRisks).toHaveBeenCalled();

    expect(agenda.nonconformities.containmentOverdue).toBe(1);
    expect(agenda.audits.findingsNotLinkedToAnAudit).toBe(1);
    expect(agenda.externalProviders.reviewGaps).toBe(1);
    expect(agenda.risks.untreated).toBe(1);
    expect(agenda.previousActions).toHaveLength(1);
  });

  it('carries counts and references, never the registers rows', async () => {
    // §9.3.2 asks for trends and aggregate performance. Returning rows here would make the endpoint a
    // way around each register's own permission, so the shape itself is the control.
    const { service } = makeService();
    const agenda = await service.assembleAgenda(null);
    expect(agenda.nonconformities.overdueReferences).toEqual(['NC-1']);
    expect(Object.keys(agenda.risks).sort()).toEqual(['untreated', 'untreatedReferences']);
    expect(JSON.stringify(agenda)).not.toContain('ownerId":"owner-1');
  });

  it('excludes the reviews OWN actions from the history it reviews', async () => {
    const { service, repo } = makeService();
    await service.assembleAgenda('mr-1');
    // At the moment a review is held, its own actions are outputs it has just produced.
    expect(repo.carriedForward).toHaveBeenCalledWith('mr-1', expect.any(Number));
  });
});

describe('holding a review', () => {
  it('freezes the composed agenda in the same transition', async () => {
    const { service, repo } = makeService();
    await service.hold('mr-1', undefined, ACTOR);

    const [, , to, extra] = repo.transition.mock.calls[0] as [
      string,
      string,
      string,
      { inputs?: Record<string, unknown>; heldOn?: string },
    ];
    expect(to).toBe('held');
    expect(extra.heldOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The snapshot is written WITH the transition, so a held review can never lack one.
    expect(extra.inputs).toBeDefined();
    expect(
      (extra.inputs as { nonconformities: { containmentOverdue: number } }).nonconformities
        .containmentOverdue,
    ).toBe(1);
  });

  it('excludes the review OWN actions from the snapshot it freezes', async () => {
    // The agenda test above calls `assembleAgenda` directly, so it proves the METHOD honours the
    // exclusion and says nothing about whether `hold` passes the id. Swapping that argument for `null`
    // survived every other test in this file, which is the gap mutation testing exists to find: a
    // review would then freeze its own freshly-raised actions as history it had reviewed.
    const { service, repo } = makeService();
    await service.hold('mr-1', undefined, ACTOR);
    expect(repo.carriedForward).toHaveBeenCalledWith('mr-1', expect.any(Number));
    expect(repo.carriedForward).not.toHaveBeenCalledWith(null, expect.any(Number));
  });

  it('refuses while a review scheduled earlier is still outstanding', async () => {
    // §9.3.2(a) asks this review for the status of actions from PREVIOUS ones, which only means
    // something if "previous" is settled.
    const { service, repo } = makeService({
      earlierOutstanding: vi
        .fn()
        .mockResolvedValue(review({ id: 'mr-0', reference: 'MR-2025-H2' })),
    });
    await expect(service.hold('mr-1', undefined, ACTOR)).rejects.toMatchObject({
      code: 'MANAGEMENT_REVIEW_OUT_OF_ORDER',
    });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('refuses before composing anything', async () => {
    // The ordering check runs first, so an out-of-order hold does not pay for five register queries.
    const { service, nonconformances } = makeService({
      earlierOutstanding: vi.fn().mockResolvedValue(review({ id: 'mr-0' })),
    });
    await expect(service.hold('mr-1', undefined, ACTOR)).rejects.toMatchObject({
      code: 'MANAGEMENT_REVIEW_OUT_OF_ORDER',
    });
    expect(nonconformances.containmentOverdue).not.toHaveBeenCalled();
  });

  it('refuses to hold a review twice', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(review({ status: 'held', heldOn: '2026-07-01' })),
    });
    await expect(service.hold('mr-1', undefined, ACTOR)).rejects.toMatchObject({
      code: 'MANAGEMENT_REVIEW_NOT_IN_STATE',
    });
  });

  it('reports a lost race rather than freezing a second snapshot', async () => {
    // Two people holding one review would otherwise both compose an agenda, and only one of them is
    // the snapshot the minutes cite.
    const { service } = makeService({ transition: vi.fn().mockResolvedValue(null) });
    await expect(service.hold('mr-1', undefined, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits holding as its own action', async () => {
    const { service, audit } = makeService();
    await service.hold('mr-1', undefined, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTION.MANAGEMENT_REVIEW_HELD }),
      expect.anything(),
    );
  });
});

describe('editing and closing', () => {
  it('refuses to edit a held review', async () => {
    // Its title and period label a snapshot that was frozen under them.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(review({ status: 'held', heldOn: '2026-07-01' })),
    });
    await expect(service.update('mr-1', { period: 'H2 2026' }, ACTOR)).rejects.toMatchObject({
      code: 'MANAGEMENT_REVIEW_NOT_IN_STATE',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to close a review that was never held', async () => {
    const { service } = makeService();
    await expect(service.close('mr-1', CONCLUSION, 'doc-1', ACTOR)).rejects.toMatchObject({
      code: 'MANAGEMENT_REVIEW_NOT_IN_STATE',
    });
  });

  it('closes a held review with its minutes', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(review({ status: 'held', heldOn: '2026-07-01' })),
    });
    await service.close('mr-1', CONCLUSION, 'doc-1', ACTOR);
    expect(repo.transition).toHaveBeenCalledWith(
      'mr-1',
      'held',
      'closed',
      expect.objectContaining({ conclusion: CONCLUSION, minutesDocumentId: 'doc-1' }),
      expect.anything(),
    );
  });
});

describe('actions (§9.3.3)', () => {
  it('refuses to raise one against a closed review', async () => {
    // An action added after the minutes are issued is an output those minutes do not contain.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(review({ status: 'closed' })),
    });
    await expect(
      service.raiseAction(
        'mr-1',
        { category: 'improvement', description: 'Add a second approver.', ownerId: 'owner-1' },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_REVIEW_SETTLED' });
    expect(repo.addAction).not.toHaveBeenCalled();
  });

  it('allows one against a held review, before the minutes are issued', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(review({ status: 'held', heldOn: '2026-07-01' })),
    });
    await expect(
      service.raiseAction(
        'mr-1',
        { category: 'resource_need', description: 'Fund a second internal auditor.', ownerId: 'o' },
        ACTOR,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses to start an action that is not open', async () => {
    const { service } = makeService({
      findActionById: vi.fn().mockResolvedValue(action({ status: 'in_progress' })),
    });
    await expect(service.startAction('mra-1', ACTOR)).rejects.toMatchObject({
      code: 'REVIEW_ACTION_NOT_IN_STATE',
    });
  });

  it('refuses any change to a settled action', async () => {
    const { service, repo } = makeService({
      findActionById: vi
        .fn()
        .mockResolvedValue(
          action({ status: 'completed', completedAt: new Date(), outcomeNote: OUTCOME }),
        ),
    });
    await expect(service.completeAction('mra-1', OUTCOME, ACTOR)).rejects.toMatchObject({
      code: 'REVIEW_ACTION_NOT_IN_STATE',
    });
    expect(repo.transitionAction).not.toHaveBeenCalled();
  });

  it('stamps the completion time and the outcome together', async () => {
    const { service, repo } = makeService();
    const completed = await service.completeAction('mra-1', OUTCOME, ACTOR);
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(repo.transitionAction).toHaveBeenCalledWith(
      'mra-1',
      'open',
      'completed',
      expect.objectContaining({ outcomeNote: OUTCOME }),
      expect.anything(),
    );
  });
});
