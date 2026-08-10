/**
 * ISMS risk register, end to end: scoring, the lifecycle, and acceptance through the request engine.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 *   - SCORES ARE GENERATED COLUMNS. `inherent_score` and `residual_score` come back computed by
 *     Postgres, and no API accepts one. Only a real database can prove that.
 *   - RESIDUAL CANNOT EXCEED INHERENT (`ck_risk_residual_not_worse`), refused with a CODE rather
 *     than the 500 a bare constraint violation produces
 *   - a risk cannot be declared TREATED while treatment actions are open
 *   - ACCEPTANCE BRANCHES ON THE THRESHOLD: below it the acceptance is recorded directly; at or
 *     above it a `risk_acceptance` request is submitted, the risk is left untouched, and only an
 *     approval by somebody holding `risk.accept` — who is not the assessor — moves it
 *   - the evidence a CHECK demands travels together: who accepted, when, and why
 *   - `risk.read` is not `risk.manage`, and neither is `risk.accept`
 *
 * SEPARATION OF DUTIES IS THE POINT OF THE THRESHOLD TEST. `SECURITY` holds `risk.manage` and NOT
 * `risk.accept`; `ADMIN` holds everything. So the assessor submits and the admin approves, which is
 * the arrangement ISO 27001 asks for and the reason acceptance is a request rather than a field.
 *
 * REFERENCES ARE UNIQUE PER RUN. `uq_risk_reference` is global and the database is shared with the
 * other suites and not reset between them, so a fixed reference makes a spec that passes once.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate`, `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds `risk.read` + `risk.manage`, and NOT `risk.accept` — the assessor. */
let security: Session;
/** Holds everything, including `risk.accept` — the approver, and a different person. */
let admin: Session;
/** Holds `risk.read` only. */
let auditor: Session;
/** Holds no permission codes at all. */
let employee: Session;

const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let seq = 0;
const nextRef = (): string => `RSK-${RUN}-${++seq}`;

/** Mirrors `ACCEPTANCE_APPROVAL_THRESHOLD` in the service — 12 on a 5x5 matrix. */
const THRESHOLD = 12;

interface RiskRow {
  id: string;
  reference: string;
  inherentLikelihood: number;
  inherentImpact: number;
  inherentScore: number | null;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  treatmentDecision: string | null;
  status: string;
  reviewDueOn: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptanceJustification: string | null;
  acceptedViaRequestId: string | null;
  closureNote: string | null;
}
interface TreatmentRow {
  id: string;
  status: string;
  completedOn: string | null;
}
interface AcceptResponse {
  risk: RiskRow;
  requestId: string | null;
}

async function req(
  session: Session,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
) {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: bearer(session),
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : {}) as unknown };
}

function data<T>(body: unknown): T {
  const b = body as { data?: T };
  return (b.data ?? body) as T;
}

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

/** A risk with the given inherent factors, owned by the security fixture. */
async function identify(likelihood: number, impact: number): Promise<RiskRow> {
  const res = await req(security, 'POST', '/risks', {
    reference: nextRef(),
    title: 'Unpatched perimeter device',
    description: 'A device on the network edge is missing vendor security updates.',
    category: 'vulnerability',
    ownerId: FIXTURE.SECURITY.id,
    inherent: { likelihood, impact },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<RiskRow>(res.body);
}

/** Identify and assess, so the risk carries a residual score of `rl × ri`. */
async function assessed(
  inherent: [number, number],
  residual: [number, number],
  decision = 'mitigate',
): Promise<RiskRow> {
  const risk = await identify(inherent[0], inherent[1]);
  const res = await req(security, 'POST', `/risks/${risk.id}/assess`, {
    decision,
    residual: { likelihood: residual[0], impact: residual[1] },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<RiskRow>(res.body);
}

beforeAll(async () => {
  app = await createTestApp();
  security = await login(app, FIXTURE.SECURITY);
  admin = await login(app, FIXTURE.ADMIN);
  auditor = await login(app, FIXTURE.AUDITOR);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('scoring', () => {
  it('computes the inherent score in the database, and accepts no score from the caller', async () => {
    const risk = await identify(4, 4);
    expect(risk.inherentScore).toBe(16);

    // The API surface has no score field: sending one is ignored rather than honoured, so a row can
    // never disagree with its own factors.
    const withScore = await req(security, 'POST', '/risks', {
      reference: nextRef(),
      title: 'Score smuggling',
      description: 'Attempts to set the score directly.',
      category: 'vulnerability',
      ownerId: FIXTURE.SECURITY.id,
      inherent: { likelihood: 1, impact: 1 },
      inherentScore: 25,
    });
    expect(withScore.status).toBe(201);
    expect(data<RiskRow>(withScore.body).inherentScore).toBe(1);
  });

  it('rejects a factor outside 1..5', async () => {
    for (const inherent of [
      { likelihood: 0, impact: 3 },
      { likelihood: 6, impact: 3 },
      { likelihood: 3, impact: 9 },
    ]) {
      const res = await req(security, 'POST', '/risks', {
        reference: nextRef(),
        title: 'Out of range',
        description: 'A factor outside the 5x5 matrix.',
        category: 'vulnerability',
        ownerId: FIXTURE.SECURITY.id,
        inherent,
      });
      expect(res.status, JSON.stringify(inherent)).toBe(422);
    }
  });

  it('refuses a duplicate reference, and an owner who does not exist', async () => {
    const reference = nextRef();
    const first = await req(security, 'POST', '/risks', {
      reference,
      title: 'First',
      description: 'The first risk with this reference.',
      category: 'vulnerability',
      ownerId: FIXTURE.SECURITY.id,
      inherent: { likelihood: 2, impact: 2 },
    });
    expect(first.status).toBe(201);

    const dup = await req(security, 'POST', '/risks', {
      reference,
      title: 'Second',
      description: 'The same reference again.',
      category: 'vulnerability',
      ownerId: FIXTURE.SECURITY.id,
      inherent: { likelihood: 2, impact: 2 },
    });
    expect(dup.status).toBe(409);

    // `owner_id` carries no cross-schema FK, so without the controller's check a typo would become a
    // risk owned by nobody.
    const nobody = await req(security, 'POST', '/risks', {
      reference: nextRef(),
      title: 'Ownerless',
      description: 'An owner id that does not resolve.',
      category: 'vulnerability',
      ownerId: '00000000-0000-7000-8000-0000000000fe',
      inherent: { likelihood: 2, impact: 2 },
    });
    expect(nobody.status).toBe(404);
  });
});

describe('assessment', () => {
  it('records the decision and computes the residual score', async () => {
    const risk = await assessed([4, 4], [2, 2]);
    expect(risk.status).toBe('assessed');
    expect(risk.treatmentDecision).toBe('mitigate');
    expect(risk.residualScore).toBe(4);
  });

  it('refuses a residual worse than the inherent score, and allows one equal to it', async () => {
    const risk = await identify(2, 2);

    const worse = await req(security, 'POST', `/risks/${risk.id}/assess`, {
      decision: 'mitigate',
      residual: { likelihood: 3, impact: 3 },
    });
    expect(worse.status).toBe(412);
    expect(errorCode(worse.body)).toBe('RISK_INVALID_SCORE');

    // Equal is legitimate: `transfer` and `accept` leave the score where it is.
    const equal = await req(security, 'POST', `/risks/${risk.id}/assess`, {
      decision: 'transfer',
      residual: { likelihood: 2, impact: 2 },
    });
    expect(equal.status).toBe(200);
    expect(data<RiskRow>(equal.body).residualScore).toBe(4);
  });

  it('refuses to lower the inherent score below a recorded residual', async () => {
    const risk = await assessed([4, 4], [3, 3]);

    const lowered = await req(security, 'PATCH', `/risks/${risk.id}`, {
      inherent: { likelihood: 2, impact: 2 },
    });
    expect(lowered.status).toBe(412);
    expect(errorCode(lowered.body)).toBe('RISK_INVALID_SCORE');
  });
});

describe('treatment', () => {
  it('refuses to mark treated while an action is open, and allows it once done', async () => {
    const risk = await assessed([4, 4], [2, 2]);

    const added = await req(security, 'POST', `/risks/${risk.id}/treatments`, {
      description: 'Patch the device and confirm the version.',
      ownerId: FIXTURE.SECURITY.id,
      dueOn: '2027-01-31',
    });
    expect(added.status).toBe(201);
    const treatment = data<TreatmentRow>(added.body);
    expect(treatment.status).toBe('planned');

    const early = await req(security, 'POST', `/risks/${risk.id}/treated`, {});
    expect(early.status).toBe(412);
    expect(errorCode(early.body)).toBe('RISK_TREATMENT_OUTSTANDING');

    const done = await req(security, 'PATCH', `/risks/treatments/${treatment.id}`, {
      status: 'done',
    });
    expect(done.status).toBe(200);
    // `ck_treatment_done_evidence` pairs `done` with a date, and the service fills today's rather
    // than making the caller send it twice.
    expect(data<TreatmentRow>(done.body).completedOn).not.toBeNull();

    const treated = await req(security, 'POST', `/risks/${risk.id}/treated`, {
      residual: { likelihood: 1, impact: 2 },
    });
    expect(treated.status, JSON.stringify(treated.body)).toBe(200);
    expect(data<RiskRow>(treated.body)).toMatchObject({ status: 'treated', residualScore: 2 });
  });

  it('does not count a CANCELLED action as outstanding', async () => {
    const risk = await assessed([3, 3], [2, 2]);
    const added = await req(security, 'POST', `/risks/${risk.id}/treatments`, {
      description: 'An approach that was abandoned.',
      ownerId: FIXTURE.SECURITY.id,
    });
    const treatment = data<TreatmentRow>(added.body);

    expect(
      (await req(security, 'PATCH', `/risks/treatments/${treatment.id}`, { status: 'cancelled' }))
        .status,
    ).toBe(200);

    // Abandoned work is not outstanding work.
    const treated = await req(security, 'POST', `/risks/${risk.id}/treated`, {});
    expect(treated.status, JSON.stringify(treated.body)).toBe(200);
  });

  it('refuses to mark a risk treated before it has been assessed', async () => {
    const risk = await identify(3, 3);
    const res = await req(security, 'POST', `/risks/${risk.id}/treated`, {});
    expect(res.status).toBe(412);
    expect(errorCode(res.body)).toBe('RISK_NOT_IN_STATE');
  });
});

describe('acceptance below the threshold', () => {
  it('records it directly, with who, when and why', async () => {
    // Residual 9 — under 12.
    const risk = await assessed([4, 4], [3, 3]);

    const accepted = await req(security, 'POST', `/risks/${risk.id}/accept`, {
      justification: 'The device is being decommissioned next quarter and is firewalled meanwhile.',
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const result = data<AcceptResponse>(accepted.body);

    expect(result.requestId).toBeNull();
    expect(result.risk.status).toBe('accepted');
    // `ck_risk_accepted_evidence` demands all three together.
    expect(result.risk.acceptedBy).toBe(FIXTURE.SECURITY.id);
    expect(result.risk.acceptedAt).not.toBeNull();
    expect(result.risk.acceptanceJustification).toContain('decommissioned');
    // No approval was involved, so there is no request to point at.
    expect(result.risk.acceptedViaRequestId).toBeNull();
  });

  it('refuses to accept a risk with no residual score, or to accept twice', async () => {
    const unassessed = await identify(3, 3);
    const early = await req(security, 'POST', `/risks/${unassessed.id}/accept`, {
      justification: 'Accepting before assessing should not be possible.',
    });
    expect(early.status).toBe(412);
    expect(errorCode(early.body)).toBe('RISK_NOT_IN_STATE');

    const risk = await assessed([3, 3], [2, 2]);
    expect(
      (
        await req(security, 'POST', `/risks/${risk.id}/accept`, {
          justification: 'Accepted once, with a reason long enough to be meaningful.',
        })
      ).status,
    ).toBe(200);
    const twice = await req(security, 'POST', `/risks/${risk.id}/accept`, {
      justification: 'Accepting a second time should be refused.',
    });
    expect(twice.status).toBe(412);
  });

  it('requires a justification of substance', async () => {
    const risk = await assessed([3, 3], [2, 2]);
    const thin = await req(security, 'POST', `/risks/${risk.id}/accept`, { justification: 'ok' });
    expect(thin.status).toBe(422);
  });
});

describe('acceptance at or above the threshold', () => {
  it('submits a request, leaves the risk untouched, and moves it only on approval', async () => {
    // Residual exactly 12 — the boundary.
    const risk = await assessed([5, 5], [4, 3]);
    expect(risk.residualScore).toBe(THRESHOLD);

    const requested = await req(security, 'POST', `/risks/${risk.id}/accept`, {
      justification: 'Compensating controls hold until the platform rebuild completes in Q3.',
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const result = data<AcceptResponse>(requested.body);

    expect(result.requestId).not.toBeNull();
    // Nothing is accepted until somebody approves it.
    expect(result.risk.status).toBe('assessed');
    expect(result.risk.acceptedBy).toBeNull();

    const stillOpen = data<RiskRow>((await req(security, 'GET', `/risks/${risk.id}`)).body);
    expect(stillOpen.status).toBe('assessed');

    // The ASSESSOR may not approve their own acceptance: `allowSelfApproval` is false, and they do
    // not hold `risk.accept` either. Both directions matter, so assert the refusal before the
    // approval that works.
    const selfApproval = await req(security, 'POST', `/requests/${result.requestId!}/approve`, {});
    expect(selfApproval.status).toBe(403);

    const approved = await req(admin, 'POST', `/requests/${result.requestId!}/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const after = data<RiskRow>((await req(security, 'GET', `/risks/${risk.id}`)).body);
    expect(after.status).toBe('accepted');
    // The APPROVER is recorded as accepting it — they are the one carrying the exposure.
    expect(after.acceptedBy).toBe(FIXTURE.ADMIN.id);
    expect(after.acceptanceJustification).toContain('Compensating controls');
    // And the evidence link points at the approval that authorised it.
    expect(after.acceptedViaRequestId).toBe(result.requestId);
  });

  it('leaves the risk where it was when the acceptance is rejected', async () => {
    const risk = await assessed([5, 5], [5, 4]); // residual 20
    const requested = data<AcceptResponse>(
      (
        await req(security, 'POST', `/risks/${risk.id}/accept`, {
          justification: 'Requesting acceptance of a high residual for illustration.',
        })
      ).body,
    );
    expect(requested.requestId).not.toBeNull();

    const rejected = await req(admin, 'POST', `/requests/${requested.requestId!}/reject`, {
      note: 'Treat it — this exposure is not one to carry.',
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    // Never moved at submission, so a refusal leaves it assessed and still open.
    const after = data<RiskRow>((await req(security, 'GET', `/risks/${risk.id}`)).body);
    expect(after.status).toBe('assessed');
    expect(after.acceptedBy).toBeNull();
  });
});

describe('closure', () => {
  it('requires a note, and refuses every later change', async () => {
    const risk = await assessed([3, 3], [2, 2]);

    expect((await req(security, 'POST', `/risks/${risk.id}/close`, {})).status).toBe(422);

    const closed = await req(security, 'POST', `/risks/${risk.id}/close`, {
      note: 'The service was decommissioned, so the risk no longer applies.',
    });
    expect(closed.status).toBe(200);
    expect(data<RiskRow>(closed.body)).toMatchObject({ status: 'closed' });
    expect(data<RiskRow>(closed.body).closureNote).toContain('decommissioned');

    // A closed risk is history: no edits, no second closure.
    expect((await req(security, 'PATCH', `/risks/${risk.id}`, { title: 'Rewritten' })).status).toBe(
      412,
    );
    expect(
      (await req(security, 'POST', `/risks/${risk.id}/close`, { note: 'Closing again.' })).status,
    ).toBe(412);
  });
});

describe('the register view', () => {
  it('orders worst first and filters by score and review date', async () => {
    const low = await identify(1, 2); // 2
    const high = await identify(5, 5); // 25

    const listed = data<RiskRow[]>((await req(security, 'GET', '/risks?limit=100')).body);
    const positions = [
      listed.findIndex((r) => r.id === high.id),
      listed.findIndex((r) => r.id === low.id),
    ];
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[1]).toBeGreaterThanOrEqual(0);
    // Worst first — the register's whole purpose.
    expect(positions[0]).toBeLessThan(positions[1]);

    const serious = data<RiskRow[]>(
      (await req(security, 'GET', '/risks?minInherentScore=20&limit=100')).body,
    );
    expect(serious.map((r) => r.id)).toContain(high.id);
    expect(serious.map((r) => r.id)).not.toContain(low.id);
  });

  it('gives the review queue for OPEN risks only', async () => {
    const due = await identify(3, 3);
    expect(
      (await req(security, 'PATCH', `/risks/${due.id}`, { reviewDueOn: '2026-01-01' })).status,
    ).toBe(200);

    const queue = () =>
      req(security, 'GET', '/risks?reviewDueOnOrBefore=2026-06-01&limit=100').then((r) =>
        data<RiskRow[]>(r.body).map((x) => x.id),
      );

    expect(await queue()).toContain(due.id);

    expect(
      (await req(security, 'POST', `/risks/${due.id}/close`, { note: 'No longer applicable.' }))
        .status,
    ).toBe(200);

    // A closed risk has no review — it would otherwise sit in the queue forever.
    expect(await queue()).not.toContain(due.id);
  });
});

describe('authorization', () => {
  it('lets a risk.read holder read but not manage', async () => {
    const risk = await identify(3, 3);

    expect((await req(auditor, 'GET', '/risks')).status).toBe(200);
    expect((await req(auditor, 'GET', `/risks/${risk.id}`)).status).toBe(200);
    expect((await req(auditor, 'GET', `/risks/${risk.id}/treatments`)).status).toBe(200);

    expect(
      (
        await req(auditor, 'POST', '/risks', {
          reference: nextRef(),
          title: 'Not allowed',
          description: 'An auditor may not write to the register.',
          category: 'vulnerability',
          ownerId: FIXTURE.SECURITY.id,
          inherent: { likelihood: 2, impact: 2 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(auditor, 'POST', `/risks/${risk.id}/assess`, {
          decision: 'mitigate',
          residual: { likelihood: 1, impact: 1 },
        })
      ).status,
    ).toBe(403);
  });

  it('refuses the register entirely to a caller holding nothing', async () => {
    expect((await req(employee, 'GET', '/risks')).status).toBe(403);
    const risk = await identify(2, 2);
    expect((await req(employee, 'GET', `/risks/${risk.id}`)).status).toBe(403);
  });
});

describe('unknown ids', () => {
  it('404s rather than answering emptily', async () => {
    const missing = '00000000-0000-7000-8000-0000000000ff';
    expect((await req(security, 'GET', `/risks/${missing}`)).status).toBe(404);
    expect((await req(security, 'GET', `/risks/${missing}/treatments`)).status).toBe(404);
    expect(
      (await req(security, 'PATCH', `/risks/treatments/${missing}`, { status: 'done' })).status,
    ).toBe(404);
  });
});
