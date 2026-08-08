/**
 * Leave entitlement, balances and the holiday calendar, end to end.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 * Leave used to be approvable without anyone knowing what it cost: `leave_requests` held two dates
 * and nothing else. The rules added here are all invisible from a single request row, so each one
 * needs a flow to prove it:
 *
 *   - a request costs WORKING days — weekends and public holidays excluded
 *   - that cost is FROZEN at submit, so a holiday declared later does not restate it
 *   - PENDING requests count against the balance, or an employee with two days left can file four
 *     two-day requests before anyone approves the first
 *   - a leave type with no entitlement row is UNTRACKED, not zero-allowance
 *   - only `workforce.manage` may change an allowance or the calendar
 *
 * Named by the `@AuthorizedInService(..., 'leave-balance.e2e.spec.ts')` declaration on
 * `GET /workforce/leave/balance`, which is a promise that this file asserts both directions.
 *
 * DATES ARE FAR IN THE FUTURE AND UNIQUE PER RUN. The database is shared with the other suites and
 * is not reset between them; `hasOverlappingLeave` refuses a second request across the same dates,
 * so fixed dates make a spec that passes once. The same mistake cost a debugging round in the
 * Playwright leave journey.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:migrate`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** Holds NO permission codes — the tier every rule here must constrain. */
let employee: Session;
/** Holds `workforce.manage` and `workforce.read`. */
let hr: Session;

/**
 * A distinct year per run, so balances and holidays cannot collide with another run's rows.
 *
 * Years rather than dates because a balance is scoped by year: two runs in the same year would
 * share a consumed total and the arithmetic assertions would depend on execution order.
 */
const YEAR = 2040 + (Math.floor(Date.now() / 1000) % 40);

/** The Monday of the first full week of a month in YEAR, as `YYYY-MM-DD`. */
function mondayIn(month: number): string {
  for (let day = 1; day <= 14; day++) {
    const d = new Date(Date.UTC(YEAR, month - 1, day));
    if (d.getUTCDay() === 1) return d.toISOString().slice(0, 10);
  }
  throw new Error('no Monday found');
}

/** `date` shifted by `days`, as `YYYY-MM-DD`. */
function plusDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function balances(
  session: Session,
  query = '',
): Promise<
  { leaveType: string; grantedDays: number; consumedDays: number; remainingDays: number }[]
> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/workforce/leave/balance?year=${YEAR}${query}`,
    headers: bearer(session),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as never;
}

async function submitLeave(
  session: Session,
  start: string,
  end: string,
  leaveType = 'annual',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/workforce/leave',
    headers: bearer(session),
    payload: { leaveType, startDate: start, endDate: end, reason: `e2e ${start}` },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

beforeAll(async () => {
  app = await createTestApp();
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
  hr = await login(app, FIXTURE.HR);
});

afterAll(async () => {
  await app?.close();
});

describe('leave entitlement and balances', () => {
  it('grants an allowance and reports it as a balance', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/workforce/leave/entitlement',
      headers: bearer(hr),
      payload: {
        employeeId: FIXTURE.NO_PERMISSIONS.id,
        leaveType: 'annual',
        year: YEAR,
        grantedDays: 10,
      },
    });
    expect(res.statusCode, res.body).toBe(204);

    const [annual] = await balances(employee);
    expect(annual).toMatchObject({
      leaveType: 'annual',
      grantedDays: 10,
      consumedDays: 0,
      remainingDays: 10,
    });
  });

  it('charges working days only, excluding a mid-week public holiday', async () => {
    const monday = mondayIn(6);
    const wednesday = plusDays(monday, 2);

    const holiday = await app.inject({
      method: 'POST',
      url: '/v1/workforce/holidays',
      headers: bearer(hr),
      payload: { date: wednesday, name: `E2E holiday ${YEAR}` },
    });
    expect(holiday.statusCode, holiday.body).toBe(201);

    // Mon–Fri is five weekdays; one of them is now a holiday.
    const { status, body } = await submitLeave(employee, monday, plusDays(monday, 4));
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.workingDays, 'the holiday was not excluded from the charge').toBe(4);

    const [annual] = await balances(employee);
    expect(annual.consumedDays).toBe(4);
    expect(annual.remainingDays).toBe(6);
  });

  it('counts a PENDING request against the balance', async () => {
    // Nothing has been approved — the previous request is still pending — so a balance that only
    // counted approvals would still read 10 remaining and let the employee spend it twice.
    const [annual] = await balances(employee);
    expect(annual.consumedDays).toBeGreaterThan(0);
    expect(annual.remainingDays).toBe(annual.grantedDays - annual.consumedDays);
  });

  it('does NOT restate an existing request when a holiday is declared later', async () => {
    const monday = mondayIn(9);
    const { status, body } = await submitLeave(employee, monday, plusDays(monday, 1));
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.workingDays).toBe(2);

    // Declare a holiday INSIDE the window that was just booked.
    const holiday = await app.inject({
      method: 'POST',
      url: '/v1/workforce/holidays',
      headers: bearer(hr),
      payload: { date: monday, name: `Retro holiday ${YEAR}` },
    });
    expect(holiday.statusCode, holiday.body).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/workforce/leave?employeeId=${FIXTURE.NO_PERMISSIONS.id}&limit=50`,
      headers: bearer(hr),
    });
    expect(res.statusCode).toBe(200);
    const rows = (JSON.parse(res.body) as { data: { startDate: string; workingDays: number }[] })
      .data;
    const booked = rows.find((r) => r.startDate === monday);

    expect(
      booked?.workingDays,
      'the charge changed after a holiday was declared inside an already-booked window — ' +
        'working_days must be frozen at submit',
    ).toBe(2);
  });

  it('refuses a request the employee cannot afford', async () => {
    // 10 granted, and the earlier tests consumed most of it.
    const [annual] = await balances(employee);
    const monday = mondayIn(11);
    const tooLong = plusDays(monday, 4 + 7 * (annual.remainingDays + 1));

    const { status, body } = await submitLeave(employee, monday, tooLong);
    expect(status, JSON.stringify(body)).toBe(412);
    expect((body.error as { code: string }).code).toBe('LEAVE_INSUFFICIENT_BALANCE');
  });

  it('refuses a window containing no working days', async () => {
    const monday = mondayIn(4);
    const saturday = plusDays(monday, 5);

    const { status, body } = await submitLeave(employee, saturday, plusDays(saturday, 1));
    expect(status, JSON.stringify(body)).toBe(412);
    expect((body.error as { code: string }).code).toBe('LEAVE_NO_WORKING_DAYS');
  });

  it('leaves an UNTRACKED leave type unconstrained', async () => {
    // No entitlement row for `unpaid`, which must mean "not tracked" rather than "zero days" —
    // otherwise every unpaid request is refused.
    const monday = mondayIn(7);
    const { status, body } = await submitLeave(employee, monday, plusDays(monday, 4), 'unpaid');

    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.workingDays).toBe(5);
    // And it does not appear as a balance, because there is no allowance to report.
    expect((await balances(employee)).map((b) => b.leaveType)).not.toContain('unpaid');
  });
});

describe('leave policy authorization', () => {
  it('refuses an employee setting their own allowance', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/workforce/leave/entitlement',
      headers: bearer(employee),
      payload: {
        employeeId: FIXTURE.NO_PERMISSIONS.id,
        leaveType: 'annual',
        year: YEAR,
        grantedDays: 999,
      },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('refuses an employee declaring a public holiday', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/workforce/holidays',
      headers: bearer(employee),
      payload: { date: `${YEAR}-12-25`, name: 'Self-declared day off' },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('lets any authenticated employee READ the holiday calendar', async () => {
    // SharedRead: unowned reference data. Gating it behind a permission would hide the calendar
    // from everyone who needs to plan around it, since the `employee` tier holds no codes.
    const res = await app.inject({
      method: 'GET',
      url: `/v1/workforce/holidays?year=${YEAR}`,
      headers: bearer(employee),
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("refuses an employee reading another employee's balance", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/workforce/leave/balance?year=${YEAR}&employeeId=${FIXTURE.HR.id}`,
      headers: bearer(employee),
    });

    // Denied, NOT silently narrowed to their own numbers — a plausible page of the wrong person's
    // data is indistinguishable from "that person has none".
    expect(res.statusCode, res.body).toBe(403);
  });

  it("lets a workforce.read holder see another employee's balance", async () => {
    const rows = await balances(hr, `&employeeId=${FIXTURE.NO_PERMISSIONS.id}`);
    expect(rows.some((b) => b.leaveType === 'annual')).toBe(true);
  });
});
