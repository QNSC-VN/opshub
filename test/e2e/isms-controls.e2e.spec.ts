/**
 * ISMS controls and the Statement of Applicability, end to end.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 *   - ONE STATEMENT PER CONTROL — `uq_soa_control`. `PUT` replaces the whole decision, so a second
 *     write leaves one row rather than two, and fields omitted the second time are CLEARED rather
 *     than carried over. Only a real database proves the index; only a real request proves the
 *     replacement semantics.
 *   - APPLICABILITY AND STATUS CANNOT DISAGREE (`ck_soa_applicability`), refused with a CODE in both
 *     directions rather than the 500 a bare constraint violation produces
 *   - AN ABSENT ENTRY IS A STATE. "Not yet decided" is a missing row, which is what `undecided` in
 *     the coverage summary counts and why the SoA is not columns on the catalogue.
 *   - A RETIRED CONTROL accepts no decision and no risk link, but keeps the ones it has
 *   - the RISK↔CONTROL link is idempotent, and the untreated-risk report is the anti-join
 *   - `control.read` is not `control.manage`
 *
 * REFERENCES ARE UNIQUE PER RUN. `uq_control_reference` and `uq_risk_reference` are global and the
 * database is shared between suites, so a fixed reference makes a spec that passes once.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate`, `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds `control.read` + `control.manage` + `risk.manage` — the ISMS owner. */
let security: Session;
/** Holds `control.read` and `risk.read` only. */
let auditor: Session;
/** Holds no permission codes at all. */
let employee: Session;

const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let seq = 0;
const nextControlRef = (): string => `E2E-C-${RUN}-${++seq}`;
const nextRiskRef = (): string => `E2E-R-${RUN}-${++seq}`;

interface ControlRow {
  id: string;
  reference: string;
  theme: string;
  source: string;
  retiredAt: string | null;
}
interface EntryRow {
  id: string;
  controlId: string;
  applicable: boolean;
  justification: string;
  status: string;
  ownerId: string | null;
  implementationNote: string | null;
  lastReviewedAt: string | null;
  reviewDueOn: string | null;
}
interface CoverageRow {
  totalControls: number;
  undecided: number;
  applicable: number;
  excluded: number;
  implemented: number;
}
interface UntreatedRow {
  riskId: string;
  reference: string;
}
interface LinkedControlRow {
  id: string;
  reference: string;
  status: string | null;
}

async function req(
  session: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

/**
 * `limit=100` throughout, never higher: `PAGE_SIZE.MAX` is 100, and a larger value is a 422 whose
 * error body then fails an array assertion with "`.some` is not a function" — which reads as a
 * response-shape problem rather than the validation refusal it is.
 */
function data<T>(body: unknown): T {
  const b = body as { data?: T };
  return (b.data ?? body) as T;
}

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

async function makeControl(over: Record<string, unknown> = {}): Promise<ControlRow> {
  const res = await req(security, 'POST', '/controls', {
    reference: nextControlRef(),
    title: 'Access control policy',
    theme: 'technological',
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<ControlRow>(res.body);
}

async function makeRisk(): Promise<{ id: string; reference: string }> {
  const res = await req(security, 'POST', '/risks', {
    reference: nextRiskRef(),
    title: 'Shared administrator credentials',
    description: 'A critical host is administered with a shared account.',
    category: 'access_control',
    ownerId: FIXTURE.SECURITY.id,
    inherent: { likelihood: 4, impact: 5 },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const risk = data<{ id: string; reference: string }>(res.body);
  return risk;
}

beforeAll(async () => {
  app = await createTestApp();
  security = await login(app, FIXTURE.SECURITY);
  auditor = await login(app, FIXTURE.AUDITOR);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('the catalogue', () => {
  it('refuses a duplicate reference', async () => {
    const reference = nextControlRef();
    expect(
      (await req(security, 'POST', '/controls', { reference, title: 'First', theme: 'people' }))
        .status,
    ).toBe(201);
    const dup = await req(security, 'POST', '/controls', {
      reference,
      title: 'Second',
      theme: 'people',
    });
    expect(dup.status).toBe(409);
  });

  it('accepts a custom control alongside Annex A', async () => {
    // ISO 27001 permits additions; the SoA has to state that Annex A was compared against, not that
    // nothing else exists.
    const custom = await makeControl({ source: 'custom', theme: 'organizational' });
    expect(custom.source).toBe('custom');

    const annexA = await makeControl();
    expect(annexA.source).toBe('annex_a');
  });

  it('hides retired controls unless asked, and keeps them addressable', async () => {
    const control = await makeControl();
    expect((await req(security, 'POST', `/controls/${control.id}/retire`)).status).toBe(200);

    const visible = data<ControlRow[]>((await req(security, 'GET', '/controls?limit=100')).body);
    expect(visible.some((c) => c.id === control.id)).toBe(false);

    const all = data<ControlRow[]>(
      (await req(security, 'GET', '/controls?limit=100&includeRetired=true')).body,
    );
    expect(all.some((c) => c.id === control.id)).toBe(true);
    // A past SoA entry references it by id, so it must still resolve directly.
    expect((await req(security, 'GET', `/controls/${control.id}`)).status).toBe(200);

    const twice = await req(security, 'POST', `/controls/${control.id}/retire`);
    expect(twice.status).toBe(412);
    expect(errorCode(twice.body)).toBe('CONTROL_RETIRED');
  });
});

describe('the Statement of Applicability', () => {
  it('treats an absent entry as a state, not an error case to paper over', async () => {
    const control = await makeControl();

    const missing = await req(security, 'GET', `/controls/soa/${control.id}`);
    expect(missing.status).toBe(404);

    // And the coverage summary counts it, which a NULL column could not distinguish from
    // "decided, no comment".
    const before = data<CoverageRow>((await req(security, 'GET', '/controls/soa/coverage')).body);
    expect(before.undecided).toBeGreaterThan(0);
  });

  it('refuses both inconsistent combinations with a code', async () => {
    const control = await makeControl();

    const excludedButDone = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: false,
      justification: 'Out of scope, yet somehow implemented.',
      status: 'implemented',
    });
    expect(excludedButDone.status).toBe(412);
    expect(errorCode(excludedButDone.body)).toBe('SOA_INCONSISTENT');

    const includedButNa = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: true,
      justification: 'In scope, yet marked not applicable.',
      status: 'not_applicable',
    });
    expect(includedButNa.status).toBe(412);
    expect(errorCode(includedButNa.body)).toBe('SOA_INCONSISTENT');
  });

  it('accepts both consistent combinations', async () => {
    const included = await makeControl();
    expect(
      (
        await req(security, 'PUT', `/controls/soa/${included.id}`, {
          applicable: true,
          justification: 'Required by the ISMS scope and covered by the policy library.',
          status: 'partially_implemented',
        })
      ).status,
    ).toBe(200);

    const excluded = await makeControl();
    const res = await req(security, 'PUT', `/controls/soa/${excluded.id}`, {
      applicable: false,
      justification: 'Out of scope: the organisation operates no industrial control systems.',
      status: 'not_applicable',
    });
    expect(res.status).toBe(200);
    expect(data<EntryRow>(res.body).applicable).toBe(false);
  });

  it('replaces the WHOLE statement, clearing what the second write omits', async () => {
    const control = await makeControl();

    const first = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: true,
      justification: 'Initial assessment: partially in place.',
      status: 'partially_implemented',
      ownerId: FIXTURE.SECURITY.id,
      implementationNote: 'Rolling out across the estate.',
      reviewDueOn: '2027-01-31',
    });
    expect(first.status).toBe(200);
    expect(data<EntryRow>(first.body).ownerId).toBe(FIXTURE.SECURITY.id);

    const second = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: true,
      justification: 'Revised assessment: fully implemented and evidenced.',
      status: 'implemented',
    });
    expect(second.status).toBe(200);
    const replaced = data<EntryRow>(second.body);
    // PUT is a replacement, not a merge: a statement that keeps half of a superseded assessment is
    // exactly the document nobody can rely on.
    expect(replaced.status).toBe('implemented');
    expect(replaced.ownerId).toBeNull();
    expect(replaced.implementationNote).toBeNull();
    expect(replaced.reviewDueOn).toBeNull();

    // Still ONE row: `uq_soa_control` is what makes the statement singular.
    const listed = data<EntryRow[]>(
      (await req(security, 'GET', `/controls/soa?limit=100`)).body,
    ).filter((e) => e.controlId === control.id);
    expect(listed).toHaveLength(1);
  });

  it('requires a justification of substance', async () => {
    const control = await makeControl();
    const thin = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: true,
      justification: 'because',
      status: 'implemented',
    });
    expect(thin.status).toBe(422);
  });

  it('refuses a decision about a retired control', async () => {
    const control = await makeControl();
    expect((await req(security, 'POST', `/controls/${control.id}/retire`)).status).toBe(200);

    const res = await req(security, 'PUT', `/controls/soa/${control.id}`, {
      applicable: true,
      justification: 'Attempting to include a control that has been retired.',
      status: 'implemented',
    });
    expect(res.status).toBe(412);
    expect(errorCode(res.body)).toBe('CONTROL_RETIRED');
  });

  it('records a review and schedules the next one', async () => {
    const control = await makeControl();
    expect(
      (
        await req(security, 'PUT', `/controls/soa/${control.id}`, {
          applicable: true,
          justification: 'In scope and implemented; reviewed annually.',
          status: 'implemented',
        })
      ).status,
    ).toBe(200);

    const reviewed = await req(security, 'POST', `/controls/soa/${control.id}/reviewed`, {
      reviewDueOn: '2028-06-30',
    });
    expect(reviewed.status).toBe(200);
    const entry = data<EntryRow>(reviewed.body);
    expect(entry.lastReviewedAt).not.toBeNull();
    expect(entry.reviewDueOn).toBe('2028-06-30');

    // And it shows up in the review queue for a date after that.
    const queue = data<EntryRow[]>(
      (await req(security, 'GET', '/controls/soa?reviewDueOnOrBefore=2028-12-31&limit=100')).body,
    );
    expect(queue.map((e) => e.controlId)).toContain(control.id);
  });

  it('404s a review of an entry that does not exist yet', async () => {
    const control = await makeControl();
    expect((await req(security, 'POST', `/controls/soa/${control.id}/reviewed`, {})).status).toBe(
      404,
    );
  });

  it('counts coverage, excluding retired controls from the total', async () => {
    const control = await makeControl();
    expect(
      (
        await req(security, 'PUT', `/controls/soa/${control.id}`, {
          applicable: true,
          justification: 'Counted in the coverage summary as implemented.',
          status: 'implemented',
        })
      ).status,
    ).toBe(200);

    const before = data<CoverageRow>((await req(security, 'GET', '/controls/soa/coverage')).body);
    expect(before.implemented).toBeGreaterThan(0);

    expect((await req(security, 'POST', `/controls/${control.id}/retire`)).status).toBe(200);

    const after = data<CoverageRow>((await req(security, 'GET', '/controls/soa/coverage')).body);
    // A retired control is not part of the statement anybody is working from, so counting it would
    // understate coverage against a catalogue nobody uses.
    expect(after.totalControls).toBe(before.totalControls - 1);
  });
});

describe('risk ↔ control', () => {
  it('links idempotently, reports both directions, and unlinks', async () => {
    const risk = await makeRisk();
    const control = await makeControl();

    expect((await req(security, 'PUT', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      204,
    );
    // The pair is the natural key, so a second link is still one link rather than a 500.
    expect((await req(security, 'PUT', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      204,
    );

    const controls = data<LinkedControlRow[]>(
      (await req(security, 'GET', `/risks/${risk.id}/controls`)).body,
    );
    expect(controls).toHaveLength(1);
    // No SoA decision recorded yet, and null is the honest answer rather than a default that reads
    // as one.
    expect(controls[0].status).toBeNull();

    const risksForControl = data<{ reference: string }[]>(
      (await req(security, 'GET', `/controls/${control.id}/risks`)).body,
    );
    expect(risksForControl.map((r) => r.reference)).toContain(risk.reference);

    expect((await req(security, 'DELETE', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      204,
    );
    const gone = await req(security, 'DELETE', `/risks/${risk.id}/controls/${control.id}`);
    expect(gone.status).toBe(404);
  });

  it('shows the SoA status once a decision exists', async () => {
    const risk = await makeRisk();
    const control = await makeControl();
    expect((await req(security, 'PUT', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      204,
    );
    expect(
      (
        await req(security, 'PUT', `/controls/soa/${control.id}`, {
          applicable: true,
          justification: 'Implemented, and treating the linked risk.',
          status: 'implemented',
        })
      ).status,
    ).toBe(200);

    const controls = data<LinkedControlRow[]>(
      (await req(security, 'GET', `/risks/${risk.id}/controls`)).body,
    );
    expect(controls[0].status).toBe('implemented');
  });

  it('refuses to assign a retired control', async () => {
    const risk = await makeRisk();
    const control = await makeControl();
    expect((await req(security, 'POST', `/controls/${control.id}/retire`)).status).toBe(200);

    const res = await req(security, 'PUT', `/risks/${risk.id}/controls/${control.id}`);
    expect(res.status).toBe(412);
    expect(errorCode(res.body)).toBe('CONTROL_RETIRED');
  });

  it('reports an untreated risk and stops once a control treats it', async () => {
    const risk = await makeRisk();

    const untreated = () =>
      req(security, 'GET', '/controls/soa/untreated-risks').then((r) =>
        data<UntreatedRow[]>(r.body).map((x) => x.riskId),
      );

    expect(await untreated()).toContain(risk.id);

    const control = await makeControl();
    expect((await req(security, 'PUT', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      204,
    );

    // The anti-join is the whole reason the link table exists.
    expect(await untreated()).not.toContain(risk.id);
  });

  it('drops a CLOSED risk from the untreated report', async () => {
    // A closed risk needs no control; leaving it in the report would make the gap list unusable.
    const risk = await makeRisk();
    expect(
      await (async () => (await req(security, 'GET', '/controls/soa/untreated-risks')).status)(),
    ).toBe(200);

    expect(
      (
        await req(security, 'POST', `/risks/${risk.id}/close`, {
          note: 'The host was decommissioned, so the exposure no longer exists.',
        })
      ).status,
    ).toBe(200);

    const ids = data<UntreatedRow[]>(
      (await req(security, 'GET', '/controls/soa/untreated-risks')).body,
    ).map((x) => x.riskId);
    expect(ids).not.toContain(risk.id);
  });

  it('404s for an unknown risk or control', async () => {
    const missing = '00000000-0000-7000-8000-0000000000ff';
    const control = await makeControl();
    const risk = await makeRisk();

    expect((await req(security, 'PUT', `/risks/${missing}/controls/${control.id}`)).status).toBe(
      404,
    );
    expect((await req(security, 'PUT', `/risks/${risk.id}/controls/${missing}`)).status).toBe(404);
    expect((await req(security, 'GET', `/risks/${missing}/controls`)).status).toBe(404);
    expect((await req(security, 'GET', `/controls/${missing}/risks`)).status).toBe(404);
  });
});

describe('authorization', () => {
  it('lets a control.read holder read but not manage', async () => {
    const control = await makeControl();

    expect((await req(auditor, 'GET', '/controls')).status).toBe(200);
    expect((await req(auditor, 'GET', '/controls/soa')).status).toBe(200);
    expect((await req(auditor, 'GET', '/controls/soa/coverage')).status).toBe(200);
    expect((await req(auditor, 'GET', '/controls/soa/untreated-risks')).status).toBe(200);

    expect(
      (
        await req(auditor, 'POST', '/controls', {
          reference: nextControlRef(),
          title: 'Not allowed',
          theme: 'people',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(auditor, 'PUT', `/controls/soa/${control.id}`, {
          applicable: true,
          justification: 'An auditor may read the statement but not write it.',
          status: 'implemented',
        })
      ).status,
    ).toBe(403);
    expect((await req(auditor, 'POST', `/controls/${control.id}/retire`)).status).toBe(403);
  });

  it('refuses linking to a caller without risk.manage', async () => {
    const risk = await makeRisk();
    const control = await makeControl();

    // The link changes the RISK, so it is `risk.manage` that governs it — not `control.read`.
    expect((await req(auditor, 'PUT', `/risks/${risk.id}/controls/${control.id}`)).status).toBe(
      403,
    );
  });

  it('refuses everything to a caller holding nothing', async () => {
    expect((await req(employee, 'GET', '/controls')).status).toBe(403);
    expect((await req(employee, 'GET', '/controls/soa')).status).toBe(403);
    expect((await req(employee, 'GET', '/controls/soa/coverage')).status).toBe(403);
  });
});
