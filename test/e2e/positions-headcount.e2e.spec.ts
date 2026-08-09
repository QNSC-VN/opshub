/**
 * Positions, approved headcount and occupancy over time — end to end.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 * `employees.job_title` is free text on the person, so before this module the org structure could
 * not be queried at all: no approved headcount, no vacancy, no record of what someone held two
 * years ago. Every rule the module adds is invisible from a single row, so each needs a flow:
 *
 *   - ONE CURRENT POSITION per employee — `uq_employee_current_position`, a partial unique index.
 *     Only a real Postgres can prove it, which is why this file exists at all.
 *   - a transfer is ONE act: the outgoing assignment closes and the incoming one opens together,
 *     so an employee is never briefly position-less and never briefly in two
 *   - approved HEADCOUNT is a ceiling on OPEN assignments, not on rows
 *   - occupancy (`filled`, `vacancies`) counts open assignments only — someone who left last month
 *     does not hold a seat
 *   - a `frozen` position keeps its occupants and accepts nobody new
 *   - an assignment cannot END BEFORE IT BEGAN, and the refusal is a 412, not the 500 a bare
 *     `ck_employee_position_window` violation produces. Found by probing the live API.
 *   - `position.read` is not `position.manage`
 *
 * CODES AND DEPARTMENTS ARE UNIQUE PER RUN. `uq_position_code` is global and the database is shared
 * with the other suites and not reset between them, so a fixed code makes a spec that passes once.
 * The department is per-run too, because the occupancy assertions list BY department and another
 * run's rows in the same department would change the count.
 *
 * ASSIGNMENTS USE THE SEEDED FIXTURES, whose current position this suite MOVES. That is safe only
 * because it is also the only suite that touches `positions`, and it is why the specs assert on
 * relative history ("the row it just closed") rather than on absolute history length.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate` and `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds `position.read` AND `position.manage`. */
let hr: Session;
/** Holds `position.read` only — the tier that separates the read half from the manage half. */
let manager: Session;
/** Holds no permission codes at all. */
let employee: Session;

/** Unique per run: `uq_position_code` is global and the database is shared between suites. */
const RUN = Date.now().toString(36).toUpperCase().slice(-6);
const DEPARTMENT = `E2E-DEPT-${RUN}`;
let seq = 0;
const nextCode = (): string => `E2E-${RUN}-${++seq}`;

interface PositionRow {
  id: string;
  code: string;
  headcount: number;
  filled: number;
  vacancies: number;
  status: string;
}
interface AssignmentRow {
  id: string;
  employeeId: string;
  positionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  endReason: string | null;
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
  // `as unknown`, not left as `JSON.parse`'s `any`: every caller goes through `data<T>()` or
  // `errorCode()`, so the shape is asserted in one place per usage rather than inferred as `any`
  // and silently spread through the whole file.
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : {}) as unknown };
}

/** `data` for wrapped responses, the payload itself otherwise. */
function data<T>(body: unknown): T {
  const b = body as { data?: T };
  return (b.data ?? body) as T;
}

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

async function createPosition(headcount: number): Promise<PositionRow> {
  const { status, body } = await req(hr, 'POST', '/positions', {
    code: nextCode(),
    title: 'E2E Engineer',
    department: DEPARTMENT,
    headcount,
  });
  expect(status).toBe(201);
  return data<PositionRow>(body);
}

/** The row for one position out of the department listing, with its occupancy counts. */
async function occupancyOf(positionId: string): Promise<PositionRow> {
  const { status, body } = await req(hr, 'GET', `/positions?department=${DEPARTMENT}&limit=100`);
  expect(status).toBe(200);
  const row = data<PositionRow[]>(body).find((p) => p.id === positionId);
  if (!row) throw new Error(`position ${positionId} missing from the ${DEPARTMENT} listing`);
  return row;
}

async function assign(
  positionId: string,
  employeeId: string,
  effectiveFrom: string,
): Promise<{ status: number; body: unknown }> {
  return req(hr, 'POST', `/positions/${positionId}/assignments`, { employeeId, effectiveFrom });
}

async function historyOf(employeeId: string): Promise<AssignmentRow[]> {
  const { status, body } = await req(hr, 'GET', `/positions/employees/${employeeId}/history`);
  expect(status).toBe(200);
  return data<AssignmentRow[]>(body);
}

beforeAll(async () => {
  app = await createTestApp();
  hr = await login(app, FIXTURE.HR);
  manager = await login(app, FIXTURE.MANAGER);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('the position catalogue', () => {
  it('refuses a duplicate code', async () => {
    const code = nextCode();
    const first = await req(hr, 'POST', '/positions', {
      code,
      title: 'First',
      department: DEPARTMENT,
    });
    expect(first.status).toBe(201);

    const second = await req(hr, 'POST', '/positions', {
      code,
      title: 'Second',
      department: DEPARTMENT,
    });
    expect(second.status).toBe(409);
  });

  it('rejects a headcount below 1', async () => {
    // `ck_position_headcount_positive` in the database, the DTO here: a position permitting nobody
    // is a CLOSED position, which is what `status` is for.
    const { status } = await req(hr, 'POST', '/positions', {
      code: nextCode(),
      title: 'Zero',
      department: DEPARTMENT,
      headcount: 0,
    });
    expect(status).toBe(422);
  });
});

describe('occupancy', () => {
  it('counts open assignments only, and a closed one frees the seat', async () => {
    const position = await createPosition(2);
    expect(await occupancyOf(position.id)).toMatchObject({ filled: 0, vacancies: 2 });

    const created = await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2030-01-01');
    expect(created.status).toBe(201);
    const assignment = data<AssignmentRow>(created.body);
    expect(await occupancyOf(position.id)).toMatchObject({ filled: 1, vacancies: 1 });

    const ended = await req(hr, 'PATCH', `/positions/assignments/${assignment.id}/end`, {
      effectiveTo: '2030-06-30',
      endReason: 'resigned',
    });
    expect(ended.status).toBe(200);

    // The row is still there — history is never deleted — but it no longer occupies a seat.
    expect(await occupancyOf(position.id)).toMatchObject({ filled: 0, vacancies: 2 });
    const history = await historyOf(FIXTURE.NO_PERMISSIONS.id);
    expect(history.find((a) => a.id === assignment.id)).toMatchObject({
      effectiveTo: '2030-06-30',
      endReason: 'resigned',
    });
  });

  it('narrows to positions with a free seat with vacantOnly', async () => {
    const full = await createPosition(1);
    const open = await createPosition(1);
    expect((await assign(full.id, FIXTURE.NO_PERMISSIONS.id, '2031-01-01')).status).toBe(201);

    const { status, body } = await req(
      hr,
      'GET',
      `/positions?department=${DEPARTMENT}&vacantOnly=true&limit=100`,
    );
    expect(status).toBe(200);
    const ids = data<PositionRow[]>(body).map((p) => p.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(full.id);
  });
});

describe('approved headcount', () => {
  it('refuses the assignment that would exceed it, and allows it once raised', async () => {
    const position = await createPosition(1);
    expect((await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2032-01-01')).status).toBe(201);

    const refused = await assign(position.id, FIXTURE.MANAGER.id, '2032-01-01');
    expect(refused.status).toBe(412);
    expect(errorCode(refused.body)).toBe('POSITION_HEADCOUNT_EXCEEDED');

    const raised = await req(hr, 'PATCH', `/positions/${position.id}`, { headcount: 2 });
    expect(raised.status).toBe(200);

    expect((await assign(position.id, FIXTURE.MANAGER.id, '2032-01-01')).status).toBe(201);
    expect(await occupancyOf(position.id)).toMatchObject({ filled: 2, vacancies: 0 });
  });

  it('allows a reduction below current occupancy, then blocks the next assignment', async () => {
    // Deliberate: a restructure is a real event and must be recordable without moving people out
    // first. The constraint belongs on the next assignment.
    const position = await createPosition(2);
    expect((await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2033-01-01')).status).toBe(201);
    expect((await assign(position.id, FIXTURE.MANAGER.id, '2033-01-01')).status).toBe(201);

    const cut = await req(hr, 'PATCH', `/positions/${position.id}`, { headcount: 1 });
    expect(cut.status).toBe(200);

    // Over-occupied, reported as zero vacancies rather than a negative number.
    expect(await occupancyOf(position.id)).toMatchObject({
      headcount: 1,
      filled: 2,
      vacancies: 0,
    });

    const refused = await assign(position.id, FIXTURE.ADMIN.id, '2033-02-01');
    expect(refused.status).toBe(412);
    expect(errorCode(refused.body)).toBe('POSITION_HEADCOUNT_EXCEEDED');
  });
});

describe('transfer', () => {
  it('closes the outgoing assignment and opens the incoming one as one act', async () => {
    const from = await createPosition(1);
    const to = await createPosition(1);

    const first = data<AssignmentRow>(
      (await assign(from.id, FIXTURE.NO_PERMISSIONS.id, '2034-01-01')).body,
    );
    const second = await assign(to.id, FIXTURE.NO_PERMISSIONS.id, '2034-07-01');
    expect(second.status).toBe(201);

    const history = await historyOf(FIXTURE.NO_PERMISSIONS.id);
    // The old row is closed on the day the new one starts, with a reason, and the new one is open.
    expect(history.find((a) => a.id === first.id)).toMatchObject({
      effectiveTo: '2034-07-01',
      endReason: 'transfer',
    });
    expect(history.find((a) => a.id === data<AssignmentRow>(second.body).id)).toMatchObject({
      effectiveTo: null,
    });
    // The invariant `uq_employee_current_position` exists to hold: exactly one open row.
    expect(history.filter((a) => a.effectiveTo === null)).toHaveLength(1);

    // And the seat they left is free again.
    expect(await occupancyOf(from.id)).toMatchObject({ filled: 0, vacancies: 1 });
  });

  it('allows a transfer into a position that their own outgoing assignment fills', async () => {
    // The count is taken AFTER the outgoing row closes, so moving between two 1-seat positions is
    // not blocked by the mover themselves.
    const from = await createPosition(1);
    const to = await createPosition(1);
    expect((await assign(from.id, FIXTURE.MANAGER.id, '2035-01-01')).status).toBe(201);
    expect((await assign(to.id, FIXTURE.MANAGER.id, '2035-02-01')).status).toBe(201);
    expect(await occupancyOf(to.id)).toMatchObject({ filled: 1, vacancies: 0 });
  });

  it('refuses re-assigning someone to the position they already hold', async () => {
    const position = await createPosition(2);
    const first = data<AssignmentRow>(
      (await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2036-01-01')).body,
    );

    const again = await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2036-06-01');
    expect(again.status).toBe(409);

    // The original row is untouched — a close-and-reopen would have rewritten its start date and
    // lost when the person actually took the job.
    const history = await historyOf(FIXTURE.NO_PERMISSIONS.id);
    expect(history.find((a) => a.id === first.id)).toMatchObject({
      effectiveFrom: '2036-01-01',
      effectiveTo: null,
    });
  });

  it('refuses a transfer dated before the current assignment began', async () => {
    const from = await createPosition(1);
    const to = await createPosition(1);
    expect((await assign(from.id, FIXTURE.NO_PERMISSIONS.id, '2037-06-01')).status).toBe(201);

    const backdated = await assign(to.id, FIXTURE.NO_PERMISSIONS.id, '2037-01-01');
    // Without the service guard this reached `ck_employee_position_window` and the caller got a
    // 500 with no indication of what was wrong. Probed live before this test existed.
    expect(backdated.status).toBe(412);
    expect(errorCode(backdated.body)).toBe('POSITION_INVALID_WINDOW');

    // Nothing half-happened: they still hold the position they started in.
    const open = (await historyOf(FIXTURE.NO_PERMISSIONS.id)).filter((a) => a.effectiveTo === null);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ positionId: from.id, effectiveFrom: '2037-06-01' });
  });
});

describe('ending an assignment', () => {
  it('refuses an end date before it began, and refuses to close it twice', async () => {
    const position = await createPosition(1);
    const assignment = data<AssignmentRow>(
      (await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2038-06-01')).body,
    );

    const early = await req(hr, 'PATCH', `/positions/assignments/${assignment.id}/end`, {
      effectiveTo: '2038-01-01',
    });
    expect(early.status).toBe(412);
    expect(errorCode(early.body)).toBe('POSITION_INVALID_WINDOW');

    const ok = await req(hr, 'PATCH', `/positions/assignments/${assignment.id}/end`, {
      effectiveTo: '2038-09-01',
    });
    expect(ok.status).toBe(200);

    // Closing a closed assignment would otherwise silently rewrite its end date, which is why the
    // repository's WHERE clause is open-only rather than a read-then-write check.
    const twice = await req(hr, 'PATCH', `/positions/assignments/${assignment.id}/end`, {
      effectiveTo: '2038-12-01',
    });
    expect(twice.status).toBe(404);
    const row = (await historyOf(FIXTURE.NO_PERMISSIONS.id)).find((a) => a.id === assignment.id);
    expect(row).toMatchObject({ effectiveTo: '2038-09-01' });
  });
});

describe('a frozen position', () => {
  it('keeps its occupants but accepts nobody new', async () => {
    const position = await createPosition(2);
    expect((await assign(position.id, FIXTURE.NO_PERMISSIONS.id, '2039-01-01')).status).toBe(201);

    const frozen = await req(hr, 'PATCH', `/positions/${position.id}`, { status: 'frozen' });
    expect(frozen.status).toBe(200);

    const refused = await assign(position.id, FIXTURE.MANAGER.id, '2039-02-01');
    expect(refused.status).toBe(412);

    // The occupant is still counted: a hiring pause is not a dismissal.
    expect(await occupancyOf(position.id)).toMatchObject({ filled: 1 });
  });
});

describe('authorization', () => {
  it('lets a position.read holder read but not manage', async () => {
    const position = await createPosition(1);

    expect((await req(manager, 'GET', `/positions/${position.id}`)).status).toBe(200);
    expect((await req(manager, 'GET', `/positions/${position.id}/assignments`)).status).toBe(200);

    // `position.manage` is separate from `position.read` because approving a headcount or moving
    // somebody between roles changes the org structure, which reading it does not.
    const create = await req(manager, 'POST', '/positions', {
      code: nextCode(),
      title: 'Nope',
      department: DEPARTMENT,
    });
    expect(create.status).toBe(403);
    expect(
      (await req(manager, 'PATCH', `/positions/${position.id}`, { headcount: 5 })).status,
    ).toBe(403);
    expect(
      (
        await req(manager, 'POST', `/positions/${position.id}/assignments`, {
          employeeId: FIXTURE.MANAGER.id,
          effectiveFrom: '2040-01-01',
        })
      ).status,
    ).toBe(403);
  });

  it('refuses the catalogue to a caller holding no permissions', async () => {
    expect((await req(employee, 'GET', '/positions')).status).toBe(403);
    expect(
      (await req(employee, 'GET', `/positions/employees/${FIXTURE.MANAGER.id}/history`)).status,
    ).toBe(403);
  });

  it('lets any employee read their OWN position history', async () => {
    // Self-scoped: knowing your own role and when it changed is not privileged information about
    // anyone else, so it needs no permission code.
    const { status, body } = await req(employee, 'GET', '/positions/me');
    expect(status).toBe(200);
    const mine = data<AssignmentRow[]>(body);
    expect(mine.every((a) => a.employeeId === FIXTURE.NO_PERMISSIONS.id)).toBe(true);
  });
});

describe('unknown ids', () => {
  it('404s rather than returning an empty history', async () => {
    const missing = '00000000-0000-7000-8000-0000000000ff';
    // An empty array would read as "nobody has ever held it", which is a different fact.
    expect((await req(hr, 'GET', `/positions/${missing}`)).status).toBe(404);
    expect((await req(hr, 'GET', `/positions/${missing}/assignments`)).status).toBe(404);
    expect((await req(hr, 'GET', `/positions/employees/${missing}/history`)).status).toBe(404);
  });

  it('refuses an assignment for an employee who does not exist', async () => {
    // `employee_id` carries no cross-schema FK, matching every other module, so without the
    // service's own check a typo would become an assignment for nobody.
    const position = await createPosition(1);
    const { status } = await assign(
      position.id,
      '00000000-0000-7000-8000-0000000000fe',
      '2041-01-01',
    );
    expect(status).toBe(404);
  });
});
