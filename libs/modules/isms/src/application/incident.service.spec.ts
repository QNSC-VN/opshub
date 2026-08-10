/**
 * IncidentService — the state machine, the timeline written by the transition, and the breach clock.
 *
 * WHY UNIT TESTS WHEN THERE IS AN E2E SUITE. `isms-incidents.e2e.spec.ts` drives the real API, the
 * six CHECKs and the overdue SQL. What it cannot reach cheaply is the ORDER and the ARGUMENTS: that a
 * status change appends its timeline entry in the SAME transaction and with the same timestamp it
 * recorded, that the guarded `WHERE status = <from>` is what a lost race reports, and that each
 * transition refuses before any write.
 *
 * The repository, the transaction and the audit are stubs, so what is under test is this service's
 * decisions.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, type DrizzleDB } from '@platform';
import { BREACH_NOTIFICATION_HOURS, IncidentService } from './incident.service';
import type { Incident, IncidentEvent } from '../domain/incident.types';

const ACTOR = { sub: 'actor-1', email: 'actor@opshub.local' };
const DETECTED = new Date('2026-03-01T02:00:00.000Z');
const CAUSE = 'A spoofed vendor email harvested one credential; MFA blocked the login.';
const LESSON = 'Block the spoofed domain at the gateway and re-run awareness training.';

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'inc-1',
    reference: 'INC-2026-004',
    title: 'Phishing email reported by staff',
    description: 'A member of staff clicked a credential-harvesting link.',
    category: 'phishing',
    severity: 'high',
    status: 'reported',
    detectedAt: DETECTED,
    reportedBy: 'reporter-1',
    assignedTo: null,
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    rootCause: null,
    lessonsLearned: null,
    assetId: null,
    riskId: null,
    personalDataBreach: false,
    regulatorNotifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function event(over: Partial<IncidentEvent> = {}): IncidentEvent {
  return {
    id: 'evt-1',
    incidentId: 'inc-1',
    type: 'note',
    detail: 'Something happened',
    recordedBy: ACTOR.sub,
    occurredAt: DETECTED,
    createdAt: new Date(),
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}) {
  const repo = {
    create: vi.fn().mockResolvedValue(incident()),
    findById: vi.fn().mockResolvedValue(incident()),
    findByReference: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    update: vi
      .fn()
      .mockImplementation((id: string, input: Partial<Incident>) =>
        Promise.resolve(incident({ id, ...input })),
      ),
    transition: vi
      .fn()
      .mockImplementation(
        (id: string, _f: string, to: Incident['status'], extra: Partial<Incident>) =>
          Promise.resolve(incident({ id, status: to, ...extra })),
      ),
    markRegulatorNotified: vi
      .fn()
      .mockImplementation((id: string, at: Date) =>
        Promise.resolve(incident({ id, personalDataBreach: true, regulatorNotifiedAt: at })),
      ),
    appendEvent: vi
      .fn()
      .mockImplementation((incidentId: string, input: Record<string, unknown>) =>
        Promise.resolve(event({ incidentId, ...(input as Partial<IncidentEvent>) })),
      ),
    listEvents: vi.fn().mockResolvedValue([]),
    overdueBreaches: vi.fn().mockResolvedValue([]),
    unlinkedToRisk: vi.fn().mockResolvedValue([]),
    ...over,
  };
  const TX = { tx: true };
  const transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX));
  const db = { transaction } as unknown as DrizzleDB;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };

  const service = new IncidentService(repo, db, audit as never);
  return { service, repo, transaction, audit, TX };
}

/** A `reported` incident staged at the given status with the timestamps it must have passed. */
function at(status: Incident['status']): Partial<Incident> {
  const contained = new Date(DETECTED.getTime() + 3_600_000);
  const resolved = new Date(contained.getTime() + 3_600_000);
  switch (status) {
    case 'triaged':
      return { status, assignedTo: 'responder-1' };
    case 'contained':
      return { status, assignedTo: 'responder-1', containedAt: contained };
    case 'resolved':
      return { status, containedAt: contained, resolvedAt: resolved, rootCause: CAUSE };
    default:
      return { status };
  }
}

describe('reportIncident', () => {
  it('refuses a duplicate reference before writing anything', async () => {
    const { service, repo } = makeService({
      findByReference: vi.fn().mockResolvedValue(incident()),
    });

    await expect(
      service.reportIncident(
        {
          reference: 'INC-2026-004',
          title: 'X',
          description: 'Y',
          category: 'phishing',
          severity: 'low',
          detectedAt: DETECTED.toISOString(),
        },
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a detection in the future', async () => {
    const { service, repo } = makeService();

    await expect(
      service.reportIncident(
        {
          reference: 'INC-9',
          title: 'X',
          description: 'Y',
          category: 'phishing',
          severity: 'low',
          detectedAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INCIDENT_TIMELINE_ORDER' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('opens the timeline at the DETECTION time, not now', async () => {
    // A timeline that starts when the form was filled loses the gap between detection and reporting,
    // which is the first thing a post-incident review looks at.
    const { service, repo, TX } = makeService();

    await service.reportIncident(
      {
        reference: 'INC-9',
        title: 'X',
        description: 'Y',
        category: 'phishing',
        severity: 'low',
        detectedAt: DETECTED.toISOString(),
      },
      ACTOR,
    );

    expect(repo.appendEvent).toHaveBeenCalledWith(
      'inc-1',
      expect.objectContaining({ type: 'status_change', occurredAt: DETECTED }),
      TX,
    );
  });

  it('records the reporter from the token, not the payload', async () => {
    const { service, repo } = makeService();

    await service.reportIncident(
      {
        reference: 'INC-9',
        title: 'X',
        description: 'Y',
        category: 'phishing',
        severity: 'low',
        detectedAt: DETECTED.toISOString(),
        // Even if a caller sends one, it must not be honoured.
        ...({ reportedBy: 'somebody-else' } as Record<string, never>),
      },
      ACTOR,
    );

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reportedBy: ACTOR.sub }),
      expect.anything(),
    );
  });
});

describe('the state machine', () => {
  it('refuses every skipped step', async () => {
    const cases: [Incident['status'], () => Promise<unknown>][] = [];
    const build = (status: Incident['status']) =>
      makeService({ findById: vi.fn().mockResolvedValue(incident(at(status))) });

    // reported cannot contain, resolve or close
    for (const move of ['contain', 'resolve', 'close'] as const) {
      const { service } = build('reported');
      cases.push([
        'reported',
        () =>
          move === 'contain'
            ? service.contain('inc-1', undefined, ACTOR)
            : move === 'resolve'
              ? service.resolve('inc-1', { rootCause: CAUSE }, ACTOR)
              : service.close('inc-1', { lessonsLearned: LESSON }, ACTOR),
      ]);
    }
    // triaged cannot resolve; contained cannot close
    const triaged = build('triaged');
    cases.push(['triaged', () => triaged.service.resolve('inc-1', { rootCause: CAUSE }, ACTOR)]);
    const contained = build('contained');
    cases.push([
      'contained',
      () => contained.service.close('inc-1', { lessonsLearned: LESSON }, ACTOR),
    ]);

    for (const [from, run] of cases) {
      await expect(run(), `from ${from}`).rejects.toMatchObject({
        code: 'INCIDENT_NOT_IN_STATE',
      });
    }
  });

  it('refuses to dismiss anything already contained', async () => {
    // Once contained it demonstrably WAS an incident, and `ck_incident_false_positive` refuses the
    // handling timestamps a later dismissal would leave behind.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('contained'))),
    });

    await expect(
      service.dismiss('inc-1', 'A test message after all.', ACTOR),
    ).rejects.toMatchObject({ code: 'INCIDENT_NOT_IN_STATE' });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('allows dismissal from reported and triaged', async () => {
    for (const status of ['reported', 'triaged'] as const) {
      const { service } = makeService({
        findById: vi.fn().mockResolvedValue(incident(at(status))),
      });
      await expect(
        service.dismiss('inc-1', 'It was a scheduled penetration test.', ACTOR),
      ).resolves.toMatchObject({ status: 'false_positive' });
    }
  });

  it('reports a lost race as a conflict, not a precondition failure', async () => {
    // The guarded WHERE returning nothing means another responder moved it — a genuine concurrent
    // edit, which is the normal case during an incident rather than the edge case.
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('triaged'))),
      transition: vi.fn().mockResolvedValue(null),
    });

    await expect(service.contain('inc-1', undefined, ACTOR)).rejects.toThrow(ConflictException);
  });
});

describe('the timeline is written by the transition', () => {
  it('appends a status_change in the same transaction, with the recorded timestamp', async () => {
    const containedAt = new Date(DETECTED.getTime() + 7_200_000);
    const { service, repo, TX } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('triaged'))),
    });

    await service.contain('inc-1', containedAt.toISOString(), ACTOR);

    // Same timestamp on the column and on the timeline: a review comparing the two must not find
    // them disagreeing by however long the request took.
    expect(repo.transition).toHaveBeenCalledWith(
      'inc-1',
      'triaged',
      'contained',
      { containedAt },
      TX,
    );
    expect(repo.appendEvent).toHaveBeenCalledWith(
      'inc-1',
      expect.objectContaining({ type: 'status_change', occurredAt: containedAt }),
      TX,
    );
  });

  it('does not append anything when the transition is refused', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('reported'))),
    });

    await expect(service.resolve('inc-1', { rootCause: CAUSE }, ACTOR)).rejects.toMatchObject({
      code: 'INCIDENT_NOT_IN_STATE',
    });
    expect(repo.appendEvent).not.toHaveBeenCalled();
  });

  it('refuses a timeline entry dated before detection', async () => {
    const { service, repo } = makeService();

    await expect(
      service.recordEvent(
        'inc-1',
        {
          type: 'note',
          detail: 'Recorded against the wrong day',
          occurredAt: new Date(DETECTED.getTime() - 3_600_000).toISOString(),
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INCIDENT_TIMELINE_ORDER' });
    expect(repo.appendEvent).not.toHaveBeenCalled();
  });

  it('allows a timeline entry on a CLOSED incident', async () => {
    // A post-incident review adds to the record after closure; refusing it would push the analysis
    // somewhere the audit trail cannot see.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(
        incident({
          ...at('resolved'),
          status: 'closed',
          closedAt: new Date(DETECTED.getTime() + 10_800_000),
          lessonsLearned: LESSON,
        }),
      ),
    });

    await expect(
      service.recordEvent('inc-1', { type: 'note', detail: 'Review completed' }, ACTOR),
    ).resolves.toBeTruthy();
    expect(repo.appendEvent).toHaveBeenCalled();
  });
});

describe('evidence requirements', () => {
  it('refuses a thin root cause and a thin lesson', async () => {
    const resolved = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('contained'))),
    });
    await expect(
      resolved.service.resolve('inc-1', { rootCause: 'unknown' }, ACTOR),
    ).rejects.toMatchObject({ code: 'INCIDENT_EVIDENCE_MISSING' });
    expect(resolved.repo.transition).not.toHaveBeenCalled();

    const closed = makeService({ findById: vi.fn().mockResolvedValue(incident(at('resolved'))) });
    await expect(
      closed.service.close('inc-1', { lessonsLearned: 'none' }, ACTOR),
    ).rejects.toMatchObject({ code: 'INCIDENT_EVIDENCE_MISSING' });
    expect(closed.repo.transition).not.toHaveBeenCalled();
  });

  it('refuses resolution dated before containment', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('contained'))),
    });

    await expect(
      service.resolve('inc-1', { rootCause: CAUSE, resolvedAt: DETECTED.toISOString() }, ACTOR),
    ).rejects.toMatchObject({ code: 'INCIDENT_TIMELINE_ORDER' });
  });
});

describe('updateIncident', () => {
  it('refuses to change a finished incident', async () => {
    for (const status of ['closed', 'false_positive'] as const) {
      const { service, repo } = makeService({
        findById: vi
          .fn()
          .mockResolvedValue(
            incident(
              status === 'closed'
                ? { ...at('resolved'), status, closedAt: new Date(), lessonsLearned: LESSON }
                : { status },
            ),
          ),
      });
      await expect(
        service.updateIncident('inc-1', { severity: 'low' }, ACTOR),
      ).rejects.toMatchObject({ code: 'INCIDENT_NOT_IN_STATE' });
      expect(repo.update).not.toHaveBeenCalled();
    }
  });

  it('refuses moving detection past a recorded containment', async () => {
    // `ck_incident_timeline_order` compares against what is already there, so this would otherwise
    // arrive as a 500 with no code.
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(incident(at('contained'))),
    });

    await expect(
      service.updateIncident(
        'inc-1',
        { detectedAt: new Date(DETECTED.getTime() + 7_200_000).toISOString() },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INCIDENT_TIMELINE_ORDER' });
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('breach notification', () => {
  it('refuses an incident that is not a personal-data breach', async () => {
    const { service, repo } = makeService();

    await expect(
      service.recordRegulatorNotification('inc-1', undefined, ACTOR),
    ).rejects.toMatchObject({ code: 'INCIDENT_NOT_A_BREACH' });
    expect(repo.markRegulatorNotified).not.toHaveBeenCalled();
  });

  it('reports an already-notified breach as a conflict', async () => {
    // The repository's WHERE clause is un-notified-only, so a null means somebody recorded it first.
    // Overwriting would erase whether the 72 hours were met.
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue(incident({ personalDataBreach: true })),
      markRegulatorNotified: vi.fn().mockResolvedValue(null),
    });

    await expect(service.recordRegulatorNotification('inc-1', undefined, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });

  it('puts the notification on the timeline as well as the column', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue(incident({ personalDataBreach: true })),
    });

    await service.recordRegulatorNotification('inc-1', undefined, ACTOR);

    // The column is what the overdue report queries; the timeline is what a reviewer reads.
    expect(repo.markRegulatorNotified).toHaveBeenCalled();
    expect(repo.appendEvent).toHaveBeenCalledWith(
      'inc-1',
      expect.objectContaining({ type: 'notification' }),
      expect.anything(),
    );
  });

  it('states the 72-hour window once', () => {
    // The constant the controller derives `notificationDueAt` from and the repository's SQL agree on
    // one number; a second literal is how they drift.
    expect(BREACH_NOTIFICATION_HOURS).toBe(72);
  });
});

describe('reports', () => {
  it('caps both reports by default', async () => {
    const { service, repo } = makeService();

    await service.overdueBreaches();
    await service.unlinkedToRisk();

    expect(repo.overdueBreaches).toHaveBeenCalledWith(100);
    expect(repo.unlinkedToRisk).toHaveBeenCalledWith(100);
  });
});
