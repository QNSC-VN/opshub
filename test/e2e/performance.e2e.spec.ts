/**
 * Performance reviews end to end: the cycle, the review, the calibration sign-off, the coverage gate.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 * Every rule here is invisible from a single row, so each needs a flow:
 *
 *   - a review cannot be created outside an OPEN cycle, and nobody reviews themselves
 *   - the employee's CURRENT position is frozen onto the review at creation
 *   - only the SUBJECT writes the self-assessment; only the ASSIGNED REVIEWER rates
 *   - a rating whose scale entry demands a development plan is refused without one
 *   - goals must total 100% and all be graded before the review can be submitted
 *   - the sign-off is a real engine request: the reviewer cannot approve their own submission, and
 *     the EMPLOYEE cannot approve their own review even holding every permission
 *   - only the subject acknowledges; a cycle will not close over reviews still in flight
 *
 * Named by the `@AuthorizedInService(..., 'performance.e2e.spec.ts')` declarations on the routes
 * whose authorization lives in the service — a promise that this file asserts both directions.
 *
 * REFERENCES ARE UNIQUE PER RUN. The database is shared with the other suites and is not reset
 * between them, and `ux_cycle_reference` is a real unique index, so a fixed reference makes a spec
 * that passes once.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:migrate`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE,
  apiRequest,
  createTestApp,
  errorCode,
  login,
  unwrap,
  type Session,
} from './support/harness';

let app: NestFastifyApplication;
/** Holds `performance.read`, `performance.manage` and `performance.approve` — runs the process. */
let hr: Session;
/** Holds `performance.read` only. The REVIEWER, which needs no permission code at all. */
let manager: Session;
/** Holds nothing. The SUBJECT — every self-service route here is scope, not permission. */
let employee: Session;
/** Wildcard permissions. The only identity that can prove the EMPLOYEE-approval refusal. */
let admin: Session;

const RUN = Math.floor(Date.now() / 1000) % 100_000;

interface CycleRow {
  id: string;
  reference: string;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
}

interface ReviewRow {
  id: string;
  cycleId: string;
  employeeId: string;
  reviewerId: string;
  positionId: string | null;
  status: string;
  selfAssessment: string | null;
  managerSummary: string | null;
  overallRating: string | null;
  developmentPlan: string | null;
  requestId: string | null;
  approvedBy: string | null;
  acknowledgedAt: string | null;
}

interface GoalRow {
  id: string;
  title: string;
  weight: number;
  rating: string | null;
  outcome: string | null;
}

/** A cycle whose period has ended, opened and ready for reviews. */
async function openCycle(suffix: string): Promise<CycleRow> {
  const created = await apiRequest(app, hr, 'POST', '/performance/cycles', {
    reference: `PR-${RUN}-${suffix}`,
    name: `E2E cycle ${suffix}`,
    periodStart: '2030-01-01',
    periodEnd: '2030-06-30',
    selfAssessmentDue: '2030-07-15',
    reviewDue: '2030-07-31',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const cycle = unwrap<CycleRow>(created.body);

  const opened = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/open`, {});
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return unwrap<CycleRow>(opened.body);
}

async function createReview(
  cycleId: string,
  employeeId: string,
  reviewerId: string,
): Promise<ReviewRow> {
  const res = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycleId}/reviews`, {
    employeeId,
    reviewerId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return unwrap<ReviewRow>(res.body);
}

/** Carry a review from creation to `manager_review` with one 100% graded goal on it. */
async function reviewReadyToSubmit(
  cycleId: string,
  subject: Session,
  subjectId: string,
  reviewer: Session,
  reviewerId: string,
): Promise<{ review: ReviewRow; goal: GoalRow }> {
  const review = await createReview(cycleId, subjectId, reviewerId);

  const self = await apiRequest(
    app,
    subject,
    'POST',
    `/performance/reviews/${review.id}/self-assessment`,
    { selfAssessment: 'I shipped the thing, and the other thing as well.' },
  );
  expect(self.status, JSON.stringify(self.body)).toBe(200);

  const goalRes = await apiRequest(
    app,
    reviewer,
    'POST',
    `/performance/reviews/${review.id}/goals`,
    {
      title: 'Ship the thing',
      target: 'Live by the end of the half',
      weight: 100,
    },
  );
  expect(goalRes.status, JSON.stringify(goalRes.body)).toBe(201);
  const goal = unwrap<GoalRow>(goalRes.body);

  const rated = await apiRequest(
    app,
    reviewer,
    'POST',
    `/performance/reviews/${review.id}/rating`,
    {
      managerSummary: 'A strong half against the goal we agreed.',
      overallRating: 'exceeds',
      goals: [{ id: goal.id, rating: 'exceeds', outcome: 'Shipped in May' }],
    },
  );
  expect(rated.status, JSON.stringify(rated.body)).toBe(200);

  return { review: unwrap<ReviewRow>(rated.body), goal };
}

beforeAll(async () => {
  app = await createTestApp();
  hr = await login(app, FIXTURE.HR);
  manager = await login(app, FIXTURE.MANAGER);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
  admin = await login(app, FIXTURE.ADMIN);
});

afterAll(async () => {
  await app?.close();
});

describe('the rating scale', () => {
  it('is published to everyone, in RANK order rather than enum order', async () => {
    // A scale you are judged against that only some people can read is not a scale.
    const res = await apiRequest(app, employee, 'GET', '/performance/rating-scale');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const levels = unwrap<
      { code: string; rank: number; label: string; requiresDevelopmentPlan: boolean }[]
    >(res.body);

    expect(levels.map((l) => l.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(levels.map((l) => l.code)).toEqual([
      'unsatisfactory',
      'needs_improvement',
      'meets',
      'exceeds',
      'outstanding',
    ]);
    // The gate that makes a low rating actionable, published so a reviewer knows BEFORE they rate.
    expect(levels.filter((l) => l.requiresDevelopmentPlan).map((l) => l.code)).toEqual([
      'unsatisfactory',
      'needs_improvement',
    ]);
  });
});

describe('cycles', () => {
  it('refuses a review deadline before the period has ended', async () => {
    // Also `ck_cycle_review_after_period`; the service restates it so the caller gets a code.
    const res = await apiRequest(app, hr, 'POST', '/performance/cycles', {
      reference: `PR-${RUN}-BAD`,
      name: 'Backwards',
      periodStart: '2030-01-01',
      periodEnd: '2030-06-30',
      reviewDue: '2030-05-01',
    });
    expect(res.status).toBe(412);
  });

  it('starts as a draft and takes no reviews until opened', async () => {
    const created = await apiRequest(app, hr, 'POST', '/performance/cycles', {
      reference: `PR-${RUN}-DRAFT`,
      name: 'Still a draft',
      periodStart: '2030-01-01',
      periodEnd: '2030-06-30',
      reviewDue: '2030-07-31',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const cycle = unwrap<CycleRow>(created.body);
    expect(cycle.status).toBe('draft');
    expect(cycle.openedAt).toBeNull();

    const tooEarly = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/reviews`, {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      reviewerId: FIXTURE.MANAGER.id,
    });
    expect(tooEarly.status).toBe(412);
    expect(errorCode(tooEarly.body)).toBe('PERFORMANCE_CYCLE_NOT_OPEN');

    // Opening is idempotent in the safe direction: the second attempt is refused, not silently
    // re-stamped with a new date.
    const opened = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/open`, {});
    expect(opened.status).toBe(200);
    expect(unwrap<CycleRow>(opened.body).openedAt).not.toBeNull();
    const again = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/open`, {});
    expect(again.status).toBe(412);
  });

  it('refuses cycle management to an identity holding only performance.read', async () => {
    const res = await apiRequest(app, manager, 'POST', '/performance/cycles', {
      reference: `PR-${RUN}-NOPE`,
      name: 'Not allowed',
      periodStart: '2030-01-01',
      periodEnd: '2030-06-30',
      reviewDue: '2030-07-31',
    });
    expect(res.status).toBe(403);
  });
});

describe('creating a review', () => {
  it('refuses a self-review', async () => {
    const cycle = await openCycle('SELF');
    const res = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/reviews`, {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      reviewerId: FIXTURE.NO_PERMISSIONS.id,
    });
    expect(res.status).toBe(412);
    expect(errorCode(res.body)).toBe('PERFORMANCE_SELF_REVIEW');
  });

  it('refuses a second review for the same employee in one cycle', async () => {
    const cycle = await openCycle('DUP');
    await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    const again = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/reviews`, {
      employeeId: FIXTURE.NO_PERMISSIONS.id,
      reviewerId: FIXTURE.MANAGER.id,
    });
    expect(again.status).toBe(409);
  });

  it('refuses an employee id that does not exist', async () => {
    // `employee_id` carries no cross-schema FK, so a typo would otherwise create a review nobody
    // can act on.
    const cycle = await openCycle('GHOST');
    const res = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/reviews`, {
      employeeId: '00000000-0000-7000-8000-0000000000ff',
      reviewerId: FIXTURE.MANAGER.id,
    });
    expect(res.status).toBe(404);
  });
});

describe('who may do what', () => {
  it('lets only the SUBJECT write the self-assessment', async () => {
    const cycle = await openCycle('SA');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    const body = { selfAssessment: 'A fair account of the half, in my own words.' };

    // The reviewer cannot write it FOR them, and neither can HR — a self-assessment written by
    // somebody else is not one, so `performance.manage` does not help here.
    for (const [who, session] of [
      ['reviewer', manager],
      ['hr', hr],
    ] as const) {
      const res = await apiRequest(
        app,
        session,
        'POST',
        `/performance/reviews/${review.id}/self-assessment`,
        body,
      );
      expect(res.status, who).toBe(403);
    }

    const mine = await apiRequest(
      app,
      employee,
      'POST',
      `/performance/reviews/${review.id}/self-assessment`,
      body,
    );
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    // …and it hands the review to the reviewer.
    expect(unwrap<ReviewRow>(mine.body).status).toBe('manager_review');
  });

  it('lets only the ASSIGNED REVIEWER rate, HR included', async () => {
    const cycle = await openCycle('RATE');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    await apiRequest(app, employee, 'POST', `/performance/reviews/${review.id}/self-assessment`, {
      selfAssessment: 'A fair account of the half, in my own words.',
    });
    const rating = { managerSummary: 'Solid work throughout the half.', overallRating: 'meets' };

    // HR runs the process but does not write the judgement: a rating attributed to the wrong person
    // is worse than a missing one.
    const byHr = await apiRequest(
      app,
      hr,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      rating,
    );
    expect(byHr.status).toBe(412);
    expect(errorCode(byHr.body)).toBe('PERFORMANCE_NOT_THE_REVIEWER');

    // Nor does the subject rate themselves.
    const bySubject = await apiRequest(
      app,
      employee,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      rating,
    );
    expect(bySubject.status).toBe(412);

    const byReviewer = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      rating,
    );
    expect(byReviewer.status, JSON.stringify(byReviewer.body)).toBe(200);
  });

  it('keeps a review out of the hands of an unrelated employee', async () => {
    // The subject, the reviewer, and whoever holds `performance.read`. Nobody else — this is the
    // most personal record in OpsHub.
    const cycle = await openCycle('PRIV');
    const review = await createReview(cycle.id, FIXTURE.ADMIN.id, FIXTURE.MANAGER.id);

    const nosy = await apiRequest(app, employee, 'GET', `/performance/reviews/${review.id}`);
    expect(nosy.status).toBe(403);

    for (const [who, session] of [
      ['the subject', admin],
      ['the reviewer', manager],
      ['performance.read', hr],
    ] as const) {
      const res = await apiRequest(app, session, 'GET', `/performance/reviews/${review.id}`);
      expect(res.status, who).toBe(200);
    }
  });
});

describe('the rating and its gates', () => {
  it('refuses a rating that demands a development plan without one', async () => {
    const cycle = await openCycle('PLAN');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    await apiRequest(app, employee, 'POST', `/performance/reviews/${review.id}/self-assessment`, {
      selfAssessment: 'A fair account of the half, in my own words.',
    });

    const without = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      {
        managerSummary: 'Several objectives were missed this half.',
        overallRating: 'needs_improvement',
      },
    );
    expect(without.status).toBe(412);
    expect(errorCode(without.body)).toBe('PERFORMANCE_DEVELOPMENT_PLAN_REQUIRED');

    const withPlan = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      {
        managerSummary: 'Several objectives were missed this half.',
        overallRating: 'needs_improvement',
        developmentPlan: 'Fortnightly coaching and a revised objective for Q3.',
      },
    );
    expect(withPlan.status, JSON.stringify(withPlan.body)).toBe(200);
    expect(unwrap<ReviewRow>(withPlan.body).developmentPlan).toContain('coaching');
    // Rating is NOT submitting: it stays with the reviewer to be discussed and revised.
    expect(unwrap<ReviewRow>(withPlan.body).status).toBe('manager_review');
  });

  it('refuses to submit until the goals total 100% and are all graded', async () => {
    const cycle = await openCycle('WEIGHT');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    await apiRequest(app, employee, 'POST', `/performance/reviews/${review.id}/self-assessment`, {
      selfAssessment: 'A fair account of the half, in my own words.',
    });

    const first = unwrap<GoalRow>(
      (
        await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/goals`, {
          title: 'Reduce flakes',
          weight: 60,
        })
      ).body,
    );
    await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/rating`, {
      managerSummary: 'Good progress on the agreed objectives.',
      overallRating: 'meets',
      goals: [{ id: first.id, rating: 'meets' }],
    });

    // 60% of the judgement accounted for: the overall rating cannot be traced to the goals.
    const short = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/submit`,
      {},
    );
    expect(short.status).toBe(412);
    expect(errorCode(short.body)).toBe('PERFORMANCE_GOAL_WEIGHTS_INVALID');

    // Re-sending the SAME TITLE edits that goal rather than adding a second — otherwise the weights
    // would be double-counted and the set would total 120.
    await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/goals`, {
      title: 'Reduce flakes',
      weight: 60,
    });
    const goals = unwrap<GoalRow[]>(
      (await apiRequest(app, manager, 'GET', `/performance/reviews/${review.id}/goals`)).body,
    );
    expect(goals).toHaveLength(1);

    const second = unwrap<GoalRow>(
      (
        await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/goals`, {
          title: 'Mentor the new joiner',
          weight: 40,
        })
      ).body,
    );

    // Weights now total 100, but the new goal has no grade.
    const ungraded = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/submit`,
      {},
    );
    expect(ungraded.status).toBe(412);
    expect(errorCode(ungraded.body)).toBe('PERFORMANCE_GOAL_WEIGHTS_INVALID');

    await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/rating`, {
      managerSummary: 'Good progress on the agreed objectives.',
      overallRating: 'meets',
      goals: [{ id: second.id, rating: 'exceeds', outcome: 'Pairing weekly since March' }],
    });
    const ok = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/submit`,
      {},
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(unwrap<ReviewRow>(ok.body).status).toBe('pending_approval');
    expect(unwrap<ReviewRow>(ok.body).requestId).not.toBeNull();
  });

  it('freezes the goals once the review has been submitted', async () => {
    const cycle = await openCycle('FROZEN');
    const { review } = await reviewReadyToSubmit(
      cycle.id,
      employee,
      FIXTURE.NO_PERMISSIONS.id,
      manager,
      FIXTURE.MANAGER.id,
    );
    await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/submit`, {});

    // Changing what somebody was judged against after they were judged is not an edit.
    const late = await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/goals`, {
      title: 'A goal invented afterwards',
      weight: 10,
    });
    expect(late.status).toBe(412);
  });
});

describe('the calibration sign-off', () => {
  it('goes through the request engine, and the reviewer cannot approve their own submission', async () => {
    const cycle = await openCycle('SIGN');
    const { review } = await reviewReadyToSubmit(
      cycle.id,
      employee,
      FIXTURE.NO_PERMISSIONS.id,
      manager,
      FIXTURE.MANAGER.id,
    );
    const submitted = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/submit`, {})).body,
    );
    const requestId = submitted.requestId!;

    // Nothing is visible to the employee yet.
    const notYet = unwrap<ReviewRow>(
      (await apiRequest(app, employee, 'GET', `/performance/reviews/${review.id}`)).body,
    );
    expect(notYet.status).toBe('pending_approval');
    const earlyAck = await apiRequest(
      app,
      employee,
      'POST',
      `/performance/reviews/${review.id}/acknowledge`,
      {},
    );
    expect(earlyAck.status).toBe(412);

    // The reviewer submitted it, so they are out of their own chain — `allowSelfApproval: false`.
    const selfApproval = await apiRequest(
      app,
      manager,
      'POST',
      `/requests/${requestId}/approve`,
      {},
    );
    expect(selfApproval.status).toBe(403);

    const approved = await apiRequest(app, hr, 'POST', `/requests/${requestId}/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const shared = unwrap<ReviewRow>(
      (await apiRequest(app, employee, 'GET', `/performance/reviews/${review.id}`)).body,
    );
    expect(shared.status).toBe('shared');
    expect(shared.approvedBy).toBe(FIXTURE.HR.id);

    // Only the subject acknowledges: an acknowledgement recorded by somebody else is evidence of
    // nothing.
    const byHr = await apiRequest(
      app,
      hr,
      'POST',
      `/performance/reviews/${review.id}/acknowledge`,
      {},
    );
    expect(byHr.status).toBe(403);

    const acked = await apiRequest(
      app,
      employee,
      'POST',
      `/performance/reviews/${review.id}/acknowledge`,
      {},
    );
    expect(acked.status, JSON.stringify(acked.body)).toBe(200);
    expect(unwrap<ReviewRow>(acked.body).status).toBe('acknowledged');
    expect(unwrap<ReviewRow>(acked.body).acknowledgedAt).not.toBeNull();
  });

  it('refuses the EMPLOYEE even when they hold every permission', async () => {
    // The engine keeps the SUBMITTER out of the chain; it has no idea a request has a SUBJECT. So
    // without the type def's own check, anybody holding `performance.approve` could approve the
    // review of themselves — and ADMIN, with the wildcard, is the identity that proves it.
    const cycle = await openCycle('SUBJECT');
    const { review } = await reviewReadyToSubmit(
      cycle.id,
      admin,
      FIXTURE.ADMIN.id,
      manager,
      FIXTURE.MANAGER.id,
    );
    const submitted = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/submit`, {})).body,
    );

    const bySubject = await apiRequest(
      app,
      admin,
      'POST',
      `/requests/${submitted.requestId!}/approve`,
      {},
    );
    expect(bySubject.status).toBe(412);
    expect(errorCode(bySubject.body)).toBe('PERFORMANCE_EMPLOYEE_APPROVAL');

    // …and the review is untouched, still waiting for somebody else.
    const after = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'GET', `/performance/reviews/${review.id}`)).body,
    );
    expect(after.status).toBe('pending_approval');
  });

  it('returns a rejected review to the reviewer WITH its rating intact', async () => {
    const cycle = await openCycle('REJECT');
    const { review } = await reviewReadyToSubmit(
      cycle.id,
      employee,
      FIXTURE.NO_PERMISSIONS.id,
      manager,
      FIXTURE.MANAGER.id,
    );
    const submitted = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/submit`, {})).body,
    );

    const rejected = await apiRequest(app, hr, 'POST', `/requests/${submitted.requestId!}/reject`, {
      reason: 'Calibrate against the rest of the team first',
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const back = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'GET', `/performance/reviews/${review.id}`)).body,
    );
    expect(back.status).toBe('manager_review');
    // The rating STAYS: it is exactly what was rejected, and clearing it would lose what has to
    // change.
    expect(back.overallRating).toBe('exceeds');
    // …and the reviewer can revise and resubmit.
    const revised = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/rating`,
      {
        managerSummary: 'Revised after calibration with the rest of the team.',
        overallRating: 'meets',
      },
    );
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    const resubmitted = await apiRequest(
      app,
      manager,
      'POST',
      `/performance/reviews/${review.id}/submit`,
      {},
    );
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
  });
});

describe('coverage and closing', () => {
  it('reports both kinds of gap, and refuses to close over them', async () => {
    const cycle = await openCycle('CLOSE');

    // An employee with NO review at all. Every active employee is a gap before anybody is reviewed.
    const beforeAny = unwrap<
      { employeeId: string; reviewId: string | null; status: string | null }[]
    >((await apiRequest(app, hr, 'GET', `/performance/cycles/${cycle.id}/coverage`)).body);
    const missing = beforeAny.find((g) => g.employeeId === FIXTURE.NO_PERMISSIONS.id);
    expect(missing, 'an employee with no review must appear').toBeDefined();
    expect(missing!.reviewId).toBeNull();
    // Missing reviews sort first, so the row a chaser needs is at the top.
    expect(beforeAny[0].reviewId).toBeNull();

    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);

    // …and now the SECOND kind: a review that exists and has stalled. Both are "not done", which is
    // why the report is a left join rather than an anti-join.
    const stalled = unwrap<
      { employeeId: string; reviewId: string | null; status: string | null }[]
    >((await apiRequest(app, hr, 'GET', `/performance/cycles/${cycle.id}/coverage`)).body).find(
      (g) => g.employeeId === FIXTURE.NO_PERMISSIONS.id,
    );
    expect(stalled!.reviewId).toBe(review.id);
    expect(stalled!.status).toBe('self_assessment');

    const tooEarly = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/close`, {});
    expect(tooEarly.status).toBe(412);
    expect(errorCode(tooEarly.body)).toBe('PERFORMANCE_CYCLE_HAS_OPEN_REVIEWS');

    // Withdrawing it settles it — the review never happened, which is a legitimate outcome for
    // somebody who left mid-cycle.
    const cancelled = await apiRequest(
      app,
      hr,
      'POST',
      `/performance/reviews/${review.id}/cancel`,
      {
        reason: 'Employee left before the review could be held',
      },
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    const closed = await apiRequest(app, hr, 'POST', `/performance/cycles/${cycle.id}/close`, {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(unwrap<CycleRow>(closed.body).closedAt).not.toBeNull();

    // A cancelled review is no longer a gap.
    const afterwards = unwrap<{ employeeId: string }[]>(
      (await apiRequest(app, hr, 'GET', `/performance/cycles/${cycle.id}/coverage`)).body,
    );
    expect(afterwards.find((g) => g.employeeId === FIXTURE.NO_PERMISSIONS.id)).toBeUndefined();
  });

  it('cannot withdraw a review the employee has already seen', async () => {
    const cycle = await openCycle('SEEN');
    const { review } = await reviewReadyToSubmit(
      cycle.id,
      employee,
      FIXTURE.NO_PERMISSIONS.id,
      manager,
      FIXTURE.MANAGER.id,
    );
    const submitted = unwrap<ReviewRow>(
      (await apiRequest(app, manager, 'POST', `/performance/reviews/${review.id}/submit`, {})).body,
    );
    await apiRequest(app, hr, 'POST', `/requests/${submitted.requestId!}/approve`, {});

    const res = await apiRequest(app, hr, 'POST', `/performance/reviews/${review.id}/cancel`, {
      reason: 'Changed our minds',
    });
    expect(res.status).toBe(412);
    expect(errorCode(res.body)).toBe('PERFORMANCE_REVIEW_SETTLED');
  });

  it('counts the reviews per state of a cycle', async () => {
    const cycle = await openCycle('PROGRESS');
    await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    await createReview(cycle.id, FIXTURE.ADMIN.id, FIXTURE.MANAGER.id);

    const res = await apiRequest(app, hr, 'GET', `/performance/cycles/${cycle.id}/progress`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = unwrap<{ status: string; count: number }[]>(res.body);
    expect(rows).toEqual([{ status: 'self_assessment', count: 2 }]);
  });
});

describe('my reviews', () => {
  it('shows the subject their own and the reviewer theirs, with no permission at all', async () => {
    const cycle = await openCycle('MINE');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);

    const mine = await apiRequest(app, employee, 'GET', `/performance/me?cycleId=${cycle.id}`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(unwrap<ReviewRow[]>(mine.body).map((r) => r.id)).toEqual([review.id]);

    const toWrite = await apiRequest(
      app,
      manager,
      'GET',
      `/performance/me/to-review?cycleId=${cycle.id}`,
    );
    expect(toWrite.status, JSON.stringify(toWrite.body)).toBe(200);
    expect(unwrap<ReviewRow[]>(toWrite.body).map((r) => r.id)).toEqual([review.id]);

    // The employee's own list does NOT include reviews they were assigned to write, and vice versa —
    // they are different questions and the two routes answer one each.
    const notMine = await apiRequest(
      app,
      employee,
      'GET',
      `/performance/me/to-review?cycleId=${cycle.id}`,
    );
    expect(unwrap<ReviewRow[]>(notMine.body)).toEqual([]);
  });

  it('freezes the position the employee held when the review was created', async () => {
    // The review is a record of THEN. `positionId` is copied at creation and never recomputed, so a
    // transfer afterwards does not restate what the review was about.
    const cycle = await openCycle('POS');
    const review = await createReview(cycle.id, FIXTURE.NO_PERMISSIONS.id, FIXTURE.MANAGER.id);
    const fetched = unwrap<ReviewRow>(
      (await apiRequest(app, hr, 'GET', `/performance/reviews/${review.id}`)).body,
    );
    // Whatever the seed gave them — the point is that the review carries its own copy, not that the
    // fixture has a position.
    expect(fetched.positionId).toBe(review.positionId);
  });
});
