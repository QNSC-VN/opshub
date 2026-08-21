/**
 * Employment contracts, end to end: lifecycle, the active-contract index, and pay visibility.
 *
 * WHAT THIS EXISTS TO PIN
 * -----------------------
 *   - ONE ACTIVE CONTRACT per employee — `uq_employee_active_contract`, a partial unique index.
 *     Only a real Postgres can prove it, which is why this file exists at all.
 *   - a RENEWAL is one act: the outgoing contract expires, the incoming one activates, and the
 *     outgoing row ends up pointing at its successor. Never two live agreements, never none.
 *   - the TYPE and the END DATE must agree (`ck_contract_type_end_date`), and every date range runs
 *     forwards — each refused with a code rather than the 500 a bare CHECK violation produces
 *   - only a DRAFT may be edited; only a SIGNED draft may be activated; only an ACTIVE contract may
 *     be terminated or renewed
 *   - PAY is gated separately from the contract: `contract.read` is not
 *     `contract.compensation.read`, and an employee always sees their own figures
 *   - the SWEEP marks contracts past their end date expired, exactly once
 *
 * PAY VISIBILITY IS ASSERTED IN BOTH DIRECTIONS. "The auditor sees null" proves nothing on its own —
 * a route broken for everyone does that too. Each redaction is paired with HR seeing the figure on
 * the same contract.
 *
 * REFERENCES ARE UNIQUE PER RUN. `uq_contract_reference` is global and the database is shared with
 * the other suites and not reset between them, so a fixed reference makes a spec that passes once.
 *
 * FIXTURES ARE USED AS CONTRACT HOLDERS, and this suite activates and terminates their contracts.
 * That is safe only because it is the only suite touching `contracts`, and `db/reset.ts` truncates
 * the table between runs — without which the first activation of run two is a 409 naming a contract
 * nobody in this file wrote.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate` and `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContractsService } from '@modules/contracts';
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
/** Holds `contract.read`, `contract.manage` AND `contract.compensation.read`. */
let hr: Session;
/** Holds `contract.read` only — NOT the compensation permission. The redaction tier. */
let auditor: Session;
/** Holds no permission codes at all. */
let employee: Session;

const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let seq = 0;
const nextRef = (): string => `E2E-${RUN}-${++seq}`;

const PAY = { baseSalary: '4500.00', salaryCurrency: 'USD', salaryPeriod: 'monthly' } as const;

interface ContractRow {
  id: string;
  employeeId: string;
  /** Resolved server-side. Null only when the employee row is gone. */
  employeeName: string | null;
  reference: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  status: string;
  supersededById: string | null;
  compensation: { baseSalary: string; salaryCurrency: string; salaryPeriod: string } | null;
}

/** A drafted contract for `employeeId`, defaulting to a signed fixed-term with pay. */
async function draft(
  employeeId: string,
  over: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  return apiRequest(app, hr, 'POST', '/contracts', {
    employeeId,
    reference: nextRef(),
    contractType: 'fixed_term',
    startDate: '2040-01-01',
    endDate: '2040-12-31',
    compensation: PAY,
    ...over,
  });
}

/** Draft and activate in one step — the state most assertions start from. */
async function activeContract(
  employeeId: string,
  over: Record<string, unknown> = {},
): Promise<ContractRow> {
  const drafted = await draft(employeeId, over);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const id = unwrap<ContractRow>(drafted.body).id;
  const activated = await apiRequest(app, hr, 'POST', `/contracts/${id}/activate`, {
    signedAt: '2039-12-01T00:00:00.000Z',
  });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  return unwrap<ContractRow>(activated.body);
}

/**
 * Clear the employee's active contract so the next assertion starts from a known slot.
 *
 * Terminates on the contract's OWN start date, not a fixed one: a renewal leaves a successor
 * starting later than the contract this helper was written against, and a hard-coded date is then
 * before its start — which the product correctly refuses with `CONTRACT_INVALID_WINDOW`. The first
 * draft of this helper did exactly that and the failure surfaced as a renewal that looked broken.
 */
async function clearActive(employeeId: string): Promise<void> {
  const { body } = await apiRequest(
    app,
    hr,
    'GET',
    `/contracts?employeeId=${employeeId}&status=active`,
  );
  for (const row of unwrap<ContractRow[]>(body)) {
    const res = await apiRequest(app, hr, 'POST', `/contracts/${row.id}/terminate`, {
      terminatedOn: row.startDate,
      terminationReason: 'e2e cleanup',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
}

beforeAll(async () => {
  app = await createTestApp();
  hr = await login(app, FIXTURE.HR);
  auditor = await login(app, FIXTURE.AUDITOR);
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('naming the employee on a contract', () => {
  /*
   * The Employee column in the SPA rendered `employeeId`, so a list of who is employed on what terms
   * identified nobody — the one question the column exists for. It has to be the API that answers it:
   * reading the directory needs `employee.read`, which a contracts reader is not required to hold, and
   * a page of fifty rows cannot cost fifty requests.
   */
  it('names the employee in the list and in the single contract', async () => {
    const created = await draft(FIXTURE.NO_PERMISSIONS.id);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = unwrap<ContractRow>(created.body).id;

    const list = await apiRequest(
      app,
      hr,
      'GET',
      `/contracts?employeeId=${FIXTURE.NO_PERMISSIONS.id}`,
    );
    expect(list.status).toBe(200);
    const rows = unwrap<ContractRow[]>(list.body);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.employeeName,
        `contract ${row.id} came back with employee ${row.employeeId} and no name`,
      ).toBeTruthy();
    }

    // The single-contract path is a SEPARATE service method, so it needs its own assertion — one of
    // the two showing a uuid is exactly the state this change was made to end.
    const one = await apiRequest(app, hr, 'GET', `/contracts/${id}`);
    expect(one.status).toBe(200);
    expect(unwrap<ContractRow>(one.body).employeeName).toBe(rows[0].employeeName);
  });
});

describe('drafting', () => {
  it('refuses a permanent contract with an end date, and a fixed one without', async () => {
    const withEnd = await draft(FIXTURE.NO_PERMISSIONS.id, {
      contractType: 'permanent',
      endDate: '2040-12-31',
    });
    expect(withEnd.status).toBe(412);
    expect(errorCode(withEnd.body)).toBe('CONTRACT_INVALID_TERM');

    const withoutEnd = await draft(FIXTURE.NO_PERMISSIONS.id, { endDate: null });
    expect(withoutEnd.status).toBe(412);
    expect(errorCode(withoutEnd.body)).toBe('CONTRACT_INVALID_TERM');

    // The other direction, so the refusals above are the rule and not a broken route.
    const permanent = await draft(FIXTURE.NO_PERMISSIONS.id, {
      contractType: 'permanent',
      endDate: null,
    });
    expect(permanent.status).toBe(201);
  });

  it('refuses a backwards date range', async () => {
    const backwards = await draft(FIXTURE.NO_PERMISSIONS.id, {
      startDate: '2040-06-01',
      endDate: '2040-01-01',
    });
    expect(backwards.status).toBe(412);
    expect(errorCode(backwards.body)).toBe('CONTRACT_INVALID_WINDOW');

    const probation = await draft(FIXTURE.NO_PERMISSIONS.id, { probationEndDate: '2039-01-01' });
    expect(probation.status).toBe(412);
    expect(errorCode(probation.body)).toBe('CONTRACT_INVALID_WINDOW');
  });

  it('refuses a duplicate reference', async () => {
    const reference = nextRef();
    expect((await draft(FIXTURE.NO_PERMISSIONS.id, { reference })).status).toBe(201);
    expect((await draft(FIXTURE.NO_PERMISSIONS.id, { reference })).status).toBe(409);
  });

  it('refuses pay with no currency or a non-positive amount', async () => {
    // `ck_contract_salary_complete` in the database, the DTO here — the three columns are one fact.
    const noCurrency = await draft(FIXTURE.NO_PERMISSIONS.id, {
      compensation: { baseSalary: '100.00', salaryPeriod: 'monthly' },
    });
    expect(noCurrency.status).toBe(422);
    const zero = await draft(FIXTURE.NO_PERMISSIONS.id, {
      compensation: { ...PAY, baseSalary: '0.00' },
    });
    expect(zero.status).toBe(422);
  });

  it('refuses a contract for an employee who does not exist', async () => {
    // `employee_id` carries no cross-schema FK, so without the controller's check a typo would
    // become a contract for nobody.
    const { status } = await draft('00000000-0000-7000-8000-0000000000fe');
    expect(status).toBe(404);
  });
});

describe('editing', () => {
  it('allows a draft to change and refuses the same change once active', async () => {
    const drafted = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);
    const edited = await apiRequest(app, hr, 'PATCH', `/contracts/${drafted.id}`, {
      noticePeriodDays: 60,
    });
    expect(edited.status).toBe(200);

    const activated = await apiRequest(app, hr, 'POST', `/contracts/${drafted.id}/activate`, {
      signedAt: '2039-12-01T00:00:00.000Z',
    });
    expect(activated.status).toBe(200);

    const refused = await apiRequest(app, hr, 'PATCH', `/contracts/${drafted.id}`, {
      noticePeriodDays: 90,
    });
    expect(refused.status).toBe(412);
    expect(errorCode(refused.body)).toBe('CONTRACT_NOT_DRAFT');

    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });

  it('validates the merged terms, not just the patch', async () => {
    // Changing only the type on a fixed-term row would leave an end date behind and hit
    // `ck_contract_type_end_date` as a 500.
    const drafted = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);

    const half = await apiRequest(app, hr, 'PATCH', `/contracts/${drafted.id}`, {
      contractType: 'permanent',
    });
    expect(half.status).toBe(412);
    expect(errorCode(half.body)).toBe('CONTRACT_INVALID_TERM');

    const whole = await apiRequest(app, hr, 'PATCH', `/contracts/${drafted.id}`, {
      contractType: 'permanent',
      endDate: null,
    });
    expect(whole.status).toBe(200);
    expect(unwrap<ContractRow>(whole.body)).toMatchObject({
      contractType: 'permanent',
      endDate: null,
    });
  });
});

describe('activation', () => {
  it('refuses an unsigned draft, then accepts a signature supplied with the activation', async () => {
    const drafted = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);

    const unsigned = await apiRequest(app, hr, 'POST', `/contracts/${drafted.id}/activate`, {});
    expect(unsigned.status).toBe(412);
    expect(errorCode(unsigned.body)).toBe('CONTRACT_NOT_SIGNED');

    const signed = await apiRequest(app, hr, 'POST', `/contracts/${drafted.id}/activate`, {
      signedAt: '2039-12-24T00:00:00.000Z',
    });
    expect(signed.status).toBe(200);
    expect(unwrap<ContractRow>(signed.body).status).toBe('active');

    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });

  it('allows only ONE active contract per employee', async () => {
    const first = await activeContract(FIXTURE.NO_PERMISSIONS.id);
    const second = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);

    const refused = await apiRequest(app, hr, 'POST', `/contracts/${second.id}/activate`, {
      signedAt: '2039-12-01T00:00:00.000Z',
    });
    // Refused in the service so the caller gets a code; `uq_employee_active_contract` is what makes
    // it true under concurrency.
    expect(refused.status).toBe(409);
    expect(errorCode(refused.body)).toBe('CONTRACT_ALREADY_ACTIVE');

    const active = unwrap<ContractRow[]>(
      (
        await apiRequest(
          app,
          hr,
          'GET',
          `/contracts?employeeId=${FIXTURE.NO_PERMISSIONS.id}&status=active`,
        )
      ).body,
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(first.id);

    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });

  it('refuses a contract whose end date has already passed', async () => {
    const stale = await draft(FIXTURE.NO_PERMISSIONS.id, {
      startDate: '2020-01-01',
      endDate: '2020-12-31',
    });
    expect(stale.status).toBe(201);

    const refused = await apiRequest(
      app,
      hr,
      'POST',
      `/contracts/${unwrap<ContractRow>(stale.body).id}/activate`,
      {
        signedAt: '2019-12-01T00:00:00.000Z',
      },
    );
    expect(refused.status).toBe(412);
    expect(errorCode(refused.body)).toBe('CONTRACT_ALREADY_ENDED');
  });
});

describe('renewal', () => {
  it('expires the outgoing contract, activates the incoming one, and links them', async () => {
    const outgoing = await activeContract(FIXTURE.NO_PERMISSIONS.id);
    const incoming = unwrap<ContractRow>(
      (await draft(FIXTURE.NO_PERMISSIONS.id, { startDate: '2041-01-01', endDate: '2041-12-31' }))
        .body,
    );

    const renewed = await apiRequest(app, hr, 'POST', `/contracts/${outgoing.id}/renew`, {
      incomingContractId: incoming.id,
      signedAt: '2040-12-01T00:00:00.000Z',
    });
    expect(renewed.status, JSON.stringify(renewed.body)).toBe(200);
    expect(unwrap<ContractRow>(renewed.body).status).toBe('active');

    const old = unwrap<ContractRow>(
      (await apiRequest(app, hr, 'GET', `/contracts/${outgoing.id}`)).body,
    );
    expect(old.status).toBe('expired');
    // The forward link is written last, so it can only point at a contract that did activate.
    expect(old.supersededById).toBe(incoming.id);

    // Never two live agreements, never none.
    const active = unwrap<ContractRow[]>(
      (
        await apiRequest(
          app,
          hr,
          'GET',
          `/contracts?employeeId=${FIXTURE.NO_PERMISSIONS.id}&status=active`,
        )
      ).body,
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(incoming.id);

    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });

  it('refuses a renewal for a different employee, and one starting earlier', async () => {
    const outgoing = await activeContract(FIXTURE.NO_PERMISSIONS.id);

    const otherPerson = unwrap<ContractRow>((await draft(FIXTURE.MANAGER.id)).body);
    const crossed = await apiRequest(app, hr, 'POST', `/contracts/${outgoing.id}/renew`, {
      incomingContractId: otherPerson.id,
      signedAt: '2039-12-01T00:00:00.000Z',
    });
    expect(crossed.status).toBe(412);

    const earlier = unwrap<ContractRow>(
      (await draft(FIXTURE.NO_PERMISSIONS.id, { startDate: '2039-01-01', endDate: '2039-12-31' }))
        .body,
    );
    const backwards = await apiRequest(app, hr, 'POST', `/contracts/${outgoing.id}/renew`, {
      incomingContractId: earlier.id,
      signedAt: '2038-12-01T00:00:00.000Z',
    });
    expect(backwards.status).toBe(412);
    expect(errorCode(backwards.body)).toBe('CONTRACT_INVALID_WINDOW');

    // Nothing half-happened: the original is still the live contract.
    const still = unwrap<ContractRow>(
      (await apiRequest(app, hr, 'GET', `/contracts/${outgoing.id}`)).body,
    );
    expect(still.status).toBe('active');

    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });

  it('refuses to renew a contract that is not active', async () => {
    const drafted = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);
    const other = unwrap<ContractRow>((await draft(FIXTURE.NO_PERMISSIONS.id)).body);

    const refused = await apiRequest(app, hr, 'POST', `/contracts/${drafted.id}/renew`, {
      incomingContractId: other.id,
      signedAt: '2039-12-01T00:00:00.000Z',
    });
    expect(refused.status).toBe(412);
    expect(errorCode(refused.body)).toBe('CONTRACT_NOT_ACTIVE');
  });
});

describe('termination', () => {
  it('requires a reason and a date on or after the start', async () => {
    const active = await activeContract(FIXTURE.NO_PERMISSIONS.id);

    const noReason = await apiRequest(app, hr, 'POST', `/contracts/${active.id}/terminate`, {
      terminatedOn: '2040-06-01',
    });
    expect(noReason.status).toBe(422);

    const early = await apiRequest(app, hr, 'POST', `/contracts/${active.id}/terminate`, {
      terminatedOn: '2039-01-01',
      terminationReason: 'resigned',
    });
    expect(early.status).toBe(412);
    expect(errorCode(early.body)).toBe('CONTRACT_INVALID_WINDOW');

    const ok = await apiRequest(app, hr, 'POST', `/contracts/${active.id}/terminate`, {
      terminatedOn: '2040-06-01',
      terminationReason: 'resigned',
    });
    expect(ok.status).toBe(200);
    expect(unwrap<ContractRow>(ok.body).status).toBe('terminated');

    // Terminating twice would rewrite the date; the guarded transition refuses.
    const twice = await apiRequest(app, hr, 'POST', `/contracts/${active.id}/terminate`, {
      terminatedOn: '2040-09-01',
      terminationReason: 'again',
    });
    expect(twice.status).toBe(412);
    expect(errorCode(twice.body)).toBe('CONTRACT_NOT_ACTIVE');
  });
});

describe('pay visibility', () => {
  it('shows the figure to HR and hides it from a contract.read holder', async () => {
    const drafted = unwrap<ContractRow>((await draft(FIXTURE.MANAGER.id)).body);

    const asHr = unwrap<ContractRow>(
      (await apiRequest(app, hr, 'GET', `/contracts/${drafted.id}`)).body,
    );
    expect(asHr.compensation).toMatchObject({ baseSalary: '4500.00', salaryCurrency: 'USD' });

    // The auditor holds `contract.read` and NOT `contract.compensation.read`: they can confirm the
    // contract exists and is signed without learning what it pays.
    const asAuditor = unwrap<ContractRow>(
      (await apiRequest(app, auditor, 'GET', `/contracts/${drafted.id}`)).body,
    );
    expect(asAuditor.reference).toBe(asHr.reference);
    expect(asAuditor.compensation).toBeNull();
  });

  it('redacts pay in the LIST as well as the single read', async () => {
    // A per-row mapper is easy to apply on one path and forget on the other.
    const listed = unwrap<ContractRow[]>(
      (await apiRequest(app, auditor, 'GET', `/contracts?employeeId=${FIXTURE.MANAGER.id}`)).body,
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((c) => c.compensation === null)).toBe(true);

    const asHr = unwrap<ContractRow[]>(
      (await apiRequest(app, hr, 'GET', `/contracts?employeeId=${FIXTURE.MANAGER.id}`)).body,
    );
    expect(asHr.some((c) => c.compensation !== null)).toBe(true);
  });

  it('lets an employee see their OWN pay with no permission at all', async () => {
    await draft(FIXTURE.NO_PERMISSIONS.id);

    const mine = unwrap<ContractRow[]>(
      (await apiRequest(app, employee, 'GET', '/contracts/me')).body,
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.employeeId === FIXTURE.NO_PERMISSIONS.id)).toBe(true);
    // Their salary is theirs — a scope rule, not a permission.
    expect(mine.some((c) => c.compensation !== null)).toBe(true);
  });

  it('refuses the collection and another employee history to a caller holding nothing', async () => {
    expect((await apiRequest(app, employee, 'GET', '/contracts')).status).toBe(403);
    expect(
      (await apiRequest(app, employee, 'GET', `/contracts/employees/${FIXTURE.MANAGER.id}/history`))
        .status,
    ).toBe(403);
  });

  it('refuses management to a read-only holder', async () => {
    expect((await draft(FIXTURE.MANAGER.id)).status).toBe(201);
    const asAuditor = await apiRequest(app, auditor, 'POST', '/contracts', {
      employeeId: FIXTURE.MANAGER.id,
      reference: nextRef(),
      contractType: 'permanent',
      startDate: '2040-01-01',
    });
    expect(asAuditor.status).toBe(403);
  });
});

describe('the expiry sweep', () => {
  it('expires a contract past its end date exactly once, and leaves the rest alone', async () => {
    // Activation refuses an already-ended contract on purpose, so the "time passed" state is reached
    // the way it happens in production: activate a live contract, then move the clock instead of
    // the row. `asOf` is the sweep's own parameter, which is why it takes one.
    const ending = await activeContract(FIXTURE.NO_PERMISSIONS.id, {
      startDate: '2040-01-01',
      endDate: '2040-03-31',
    });
    const untouched = await activeContract(FIXTURE.MANAGER.id, {
      startDate: '2040-01-01',
      endDate: '2040-12-31',
    });

    const service = app.get(ContractsService);
    const first = await service.expireDueContracts('2040-06-01');
    expect(first).toBeGreaterThanOrEqual(1);

    const swept = unwrap<ContractRow>(
      (await apiRequest(app, hr, 'GET', `/contracts/${ending.id}`)).body,
    );
    expect(swept.status).toBe('expired');

    // The other contract has not reached its end date, so the sweep must not have moved it.
    const other = unwrap<ContractRow>(
      (await apiRequest(app, hr, 'GET', `/contracts/${untouched.id}`)).body,
    );
    expect(other.status).toBe('active');

    // Idempotent: the transition is guarded on `active`, so a second pass finds nothing to do.
    expect(await service.expireDueContracts('2040-06-01')).toBe(0);

    await clearActive(FIXTURE.MANAGER.id);
  });

  it('reports contracts inside the reminder window and none outside it', async () => {
    const soon = await activeContract(FIXTURE.NO_PERMISSIONS.id, {
      startDate: '2045-01-01',
      endDate: '2045-01-20',
    });

    const service = app.get(ContractsService);
    // 30 days before it ends: inside the window.
    expect(await service.remindExpiringContracts(30, '2045-01-01')).toBeGreaterThanOrEqual(1);
    // Five days before it ends is 15 days too early for a 5-day window.
    expect(await service.remindExpiringContracts(5, '2045-01-01')).toBe(0);

    expect(soon.status).toBe('active');
    await clearActive(FIXTURE.NO_PERMISSIONS.id);
  });
});

describe('unknown ids', () => {
  it('404s rather than answering emptily', async () => {
    const missing = '00000000-0000-7000-8000-0000000000ff';
    expect((await apiRequest(app, hr, 'GET', `/contracts/${missing}`)).status).toBe(404);
    expect(
      (await apiRequest(app, hr, 'GET', `/contracts/employees/${missing}/history`)).status,
    ).toBe(404);
  });
});
