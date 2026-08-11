import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  ErrorCodes,
  InjectDrizzle,
  PreconditionFailedException,
  type DbExecutor,
  type DrizzleDB,
} from '@platform';
import { today } from '@shared-kernel';
import {
  holidays,
  leavePolicies,
  leaveEntitlements,
  leaveRequests,
  leaveTypeEnum,
} from '../../../../../db/schema';
import { leaveWindowCost, type LeaveWindow } from '../domain/leave-window';
import {
  accruedDays,
  carriedOverStillAvailable,
  carryOverAmount,
  carryOverExpiryDate,
  roundDays,
} from '../domain/leave-accrual';
import type { LeaveAccrualMethod, LeaveType } from '../domain/workforce.types';

/**
 * The policy for one leave type, or the default for a type that has none.
 *
 * A MISSING POLICY IS A MEANING: `annual_grant` with no carry-over, which is exactly how every
 * entitlement behaved before accrual existed. That default is what makes this feature
 * behaviour-preserving rather than a silent change to every balance in the system.
 */
export interface LeavePolicy {
  accrualMethod: LeaveAccrualMethod;
  carryOverMaxDays: number;
  carryOverExpiryMonths: number | null;
}

const DEFAULT_POLICY: LeavePolicy = {
  accrualMethod: 'annual_grant',
  carryOverMaxDays: 0,
  carryOverExpiryMonths: null,
};

/** What an employee has, has used, and may still take, for one leave type in one year. */
export interface LeaveBalance {
  leaveType: LeaveType;
  year: number;
  /** The year's whole entitlement, as HR set it. */
  grantedDays: number;
  /**
   * How much of that has been EARNED as of the date the balance was read.
   *
   * Equal to `grantedDays` under `annual_grant`; a twelfth per month under `monthly_accrual`.
   */
  accruedDays: number;
  carriedOverDays: number;
  /** When the carried days lapse, or null when they do not. */
  carriedOverExpiresOn: string | null;
  /** Whether those carried days still count today. False once the expiry date has passed. */
  carriedOverAvailable: boolean;
  /** Working days already committed — APPROVED plus still-PENDING requests. */
  consumedDays: number;
  /**
   * What may actually be booked right now: `accrued + carried (if unexpired) − consumed`.
   *
   * This is the number the balance check enforces. It differs from `remainingDays` whenever the year
   * is only part-accrued or carried days have lapsed, and that difference is the whole feature.
   */
  availableDays: number;
  /**
   * granted + carriedOver − consumed, ignoring accrual and expiry.
   *
   * Kept because it is what the year will settle at, and a screen that only showed today's available
   * figure could not tell somebody how much leave they have for the year. May be negative if an
   * entitlement was reduced after days were taken.
   */
  remainingDays: number;
}

/**
 * Leave entitlement and balance arithmetic.
 *
 * TWO RULES CARRY THE WHOLE DESIGN.
 *
 * 1. A BALANCE IS DERIVED, NEVER STORED. `granted + carriedOver − consumed`, computed on read.
 *    A stored counter drifts the first time a request is cancelled, back-dated or corrected, and
 *    once it has drifted no query can say whether the counter or the requests are wrong. The cost
 *    is one aggregate per read, which is nothing against a table of leave requests per employee.
 *
 * 2. PENDING REQUESTS COUNT AS CONSUMED. Otherwise an employee with two days left files four
 *    separate two-day requests before anyone approves the first, and every one of them passes the
 *    check — the classic double-spend. Consumed therefore spans `pending` and `approved`, and only
 *    a rejection or cancellation releases the days.
 *
 * A leave type with NO entitlement row is UNTRACKED, not zero: unpaid and compassionate leave are
 * decided on their merits. Treating a missing row as a zero allowance would refuse every such
 * request, which is why {@link assertSufficientBalance} returns early rather than defaulting.
 *
 * 3. ACCRUAL AND EXPIRY ARE READ-TIME DECISIONS, for the same reason as rule 1. How much of a year's
 *    grant has been earned is `granted × months ÷ 12`, and whether carried days still count is a
 *    comparison against today — neither needs a row, and neither can drift. What IS stored is what a
 *    carry-over RUN decided, because that is a decision rather than arithmetic. See
 *    `domain/leave-accrual.ts`.
 */
@Injectable()
export class LeaveBalanceService {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /**
   * Every leave policy, keyed by type.
   *
   * Read per call and not cached: the table has at most one row per leave type, and a stale accrual
   * method is exactly what would let a part-accrued year be spent in full. The same reasoning as the
   * classification levels and the vendor criticality tiers.
   */
  async policies(tx?: DbExecutor): Promise<Map<LeaveType, LeavePolicy>> {
    const rows = await (tx ?? this.db).select().from(leavePolicies);
    return new Map(
      rows.map((r) => [
        r.leaveType,
        {
          accrualMethod: r.accrualMethod,
          carryOverMaxDays: Number(r.carryOverMaxDays),
          carryOverExpiryMonths: r.carryOverExpiryMonths,
        },
      ]),
    );
  }

  /**
   * Every leave type with its policy, or the default where none is set.
   *
   * A row per TYPE, not per configured policy: "annual leave accrues monthly" and "nobody has decided
   * how sick leave accrues" are different answers, and `isDefault` is what distinguishes them.
   */
  async listPolicies(): Promise<
    {
      leaveType: LeaveType;
      accrualMethod: LeaveAccrualMethod;
      carryOverMaxDays: number;
      carryOverExpiryMonths: number | null;
      note: string | null;
      isDefault: boolean;
    }[]
  > {
    const rows = await this.db.select().from(leavePolicies);
    const byType = new Map(rows.map((r) => [r.leaveType, r]));
    return leaveTypeEnum.enumValues.map((leaveType) => {
      const row = byType.get(leaveType);
      return row
        ? {
            leaveType,
            accrualMethod: row.accrualMethod,
            carryOverMaxDays: Number(row.carryOverMaxDays),
            carryOverExpiryMonths: row.carryOverExpiryMonths,
            note: row.note,
            isDefault: false,
          }
        : { leaveType, ...DEFAULT_POLICY, note: null, isDefault: true };
    });
  }

  /** Public holidays between two dates, as a set of `YYYY-MM-DD`. */
  async holidaysBetween(start: string, end: string, tx?: DbExecutor): Promise<Set<string>> {
    const rows = await (tx ?? this.db)
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, start), lte(holidays.date, end)));
    return new Set(rows.map((r) => r.date));
  }

  /**
   * What a window costs in days, with the holiday calendar applied.
   *
   * The single place leave cost is computed, so the stored `working_days` on a request and the
   * `consumedDays` in a balance can never disagree about what a day off means. Takes the whole
   * window rather than two dates so a part-day request cannot reach the cost rule with its portions
   * dropped on the way — which would silently charge a full day for an afternoon.
   */
  async leaveCostFor(window: LeaveWindow, tx?: DbExecutor): Promise<number> {
    const holidays = await this.holidaysBetween(window.startDate, window.endDate, tx);
    return leaveWindowCost(window, holidays);
  }

  /**
   * Every tracked balance for an employee in a year.
   *
   * `asOf` exists so a caller can ask what was available on a past date — the question an approver
   * asks about a back-dated request — and so the tests can pin accrual without mocking the clock.
   */
  async listBalances(
    employeeId: string,
    year: number,
    asOf: string = today(),
  ): Promise<LeaveBalance[]> {
    const grants = await this.db
      .select()
      .from(leaveEntitlements)
      .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year)));

    const policies = await this.policies();
    const balances: LeaveBalance[] = [];
    for (const grant of grants) {
      // Read ONCE and reuse. Querying twice would let `consumedDays` and `remainingDays` disagree
      // with each other whenever a request is submitted between the two reads — a row that reports
      // its own arithmetic as inconsistent is worse than either number being slightly stale.
      const consumed = await this.consumedDays(employeeId, grant.leaveType, year);
      const granted = Number(grant.grantedDays);
      const carried = Number(grant.carriedOverDays);
      const policy = policies.get(grant.leaveType) ?? DEFAULT_POLICY;
      const accrued = accruedDays(granted, policy.accrualMethod, year, asOf);
      const carriedAvailable = carriedOverStillAvailable(grant.carriedOverExpiresOn, asOf);

      balances.push({
        leaveType: grant.leaveType,
        year,
        grantedDays: granted,
        accruedDays: accrued,
        carriedOverDays: carried,
        carriedOverExpiresOn: grant.carriedOverExpiresOn,
        carriedOverAvailable: carriedAvailable,
        consumedDays: consumed,
        availableDays: roundDays(accrued + (carriedAvailable ? carried : 0) - consumed),
        remainingDays: roundDays(granted + carried - consumed),
      });
    }
    return balances;
  }

  /**
   * Working days already committed for a type in a year.
   *
   * Attributed by START DATE. A window spanning New Year is charged wholly to the year it began
   * in, which is a choice rather than an accident: splitting it would need the request's cost
   * recomputed per year and would make the two years' balances disagree with the single stored
   * `working_days`. Worth revisiting only if the leave policy starts prorating across years.
   */
  async consumedDays(
    employeeId: string,
    leaveType: LeaveType,
    year: number,
    tx?: DbExecutor,
  ): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({ total: sql<string>`coalesce(sum(${leaveRequests.workingDays}), 0)` })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.leaveType, leaveType),
          gte(leaveRequests.startDate, `${year}-01-01`),
          lte(leaveRequests.startDate, `${year}-12-31`),
          // Pending counts: see rule 2 on the class.
          inArray(leaveRequests.status, ['pending', 'approved']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  // ── Holiday calendar (reference data) ──────────────────────────────────────

  /** Holidays in a calendar year, earliest first. */
  async listHolidays(
    year: number,
  ): Promise<{ id: string; date: string; name: string; region: string }[]> {
    return (
      this.db
        .select({
          id: holidays.id,
          date: holidays.date,
          name: holidays.name,
          region: holidays.region,
        })
        .from(holidays)
        .where(and(gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`)))
        // `date` is unique per region but not on its own, so `id` breaks the tie — without it two
        // regional holidays on one date can swap places between pages.
        .orderBy(holidays.date, holidays.id)
    );
  }

  /**
   * Declare a public holiday.
   *
   * Does NOT retrospectively change what existing requests cost: `working_days` is frozen on each
   * row at submit. Declaring a holiday inside a window someone already booked leaves their charge
   * as it was, which is the honest outcome — their leave was approved against the calendar as it
   * stood.
   */
  async addHoliday(
    input: { date: string; name: string; region?: string },
    tx?: DbExecutor,
  ): Promise<{ id: string }> {
    const [row] = await (tx ?? this.db)
      .insert(holidays)
      .values({ date: input.date, name: input.name, region: input.region ?? 'ALL' })
      .onConflictDoUpdate({
        target: [holidays.date, holidays.region],
        set: { name: input.name },
      })
      .returning({ id: holidays.id });
    return row;
  }

  async removeHoliday(id: string, tx?: DbExecutor): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .delete(holidays)
      .where(eq(holidays.id, id))
      .returning({ id: holidays.id });
    return rows.length > 0;
  }

  // ── Entitlements ───────────────────────────────────────────────────────────

  /**
   * Set an employee's allowance for one leave type and year.
   *
   * Upsert rather than insert: an allowance is corrected far more often than it is created —
   * a mid-year joiner's prorated days, a policy change — and a unique violation on the second
   * attempt would be a worse answer than the obvious one.
   */
  async setEntitlement(
    input: {
      employeeId: string;
      leaveType: LeaveType;
      year: number;
      grantedDays: number;
      carriedOverDays?: number;
      note?: string | null;
    },
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? this.db)
      .insert(leaveEntitlements)
      .values({
        employeeId: input.employeeId,
        leaveType: input.leaveType,
        year: input.year,
        grantedDays: String(input.grantedDays),
        carriedOverDays: String(input.carriedOverDays ?? 0),
        note: input.note ?? null,
      })
      .onConflictDoUpdate({
        target: [leaveEntitlements.employeeId, leaveEntitlements.leaveType, leaveEntitlements.year],
        set: {
          grantedDays: String(input.grantedDays),
          carriedOverDays: String(input.carriedOverDays ?? 0),
          note: input.note ?? null,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Refuse a request the employee cannot afford.
   *
   * Called INSIDE the submit transaction so the check and the insert cannot be separated by a
   * concurrent request — two simultaneous submissions would otherwise both read the same balance
   * and both pass.
   *
   * A zero-day request is refused too. Someone picking a Saturday to Sunday window has almost
   * certainly mistaken the dates, and accepting it creates a request that costs nothing, needs an
   * approval, and confuses every report it appears in.
   */
  async assertSufficientBalance(
    employeeId: string,
    leaveType: LeaveType,
    year: number,
    requestedDays: number,
    tx?: DbExecutor,
    /**
     * The last day of the window being requested, used as the moment accrual is judged at.
     *
     * ACCRUAL LIMITS WHAT MAY BE TAKEN, NOT WHEN IT MAY BE BOOKED. Judging it as of TODAY would
     * refuse every advance booking — no December leave requested in March, and nothing at all in next
     * year — which is not what earning leave monthly means and would make the feature a regression.
     * Judging it as of the window's end asks the question that matters: by the time these days are
     * taken, will they have been earned?
     *
     * Defaults to today so an existing caller that passes no window still gets a correct, if
     * stricter, answer rather than an unchecked one.
     */
    asOfDate?: string,
  ): Promise<void> {
    if (requestedDays <= 0) {
      throw new PreconditionFailedException(
        ErrorCodes.LEAVE_NO_WORKING_DAYS,
        'That window contains no working days — check the dates.',
      );
    }

    const [grant] = await (tx ?? this.db)
      .select()
      .from(leaveEntitlements)
      .where(
        and(
          eq(leaveEntitlements.employeeId, employeeId),
          eq(leaveEntitlements.leaveType, leaveType),
          eq(leaveEntitlements.year, year),
        ),
      );

    // Untracked type — no allowance to check against. See the class docblock.
    if (!grant) return;

    const policy = (await this.policies(tx)).get(leaveType) ?? DEFAULT_POLICY;
    const granted = Number(grant.grantedDays);
    const carried = Number(grant.carriedOverDays);
    const consumed = await this.consumedDays(employeeId, leaveType, year, tx);

    // As of the END of the window — see the parameter's docblock for why this is not today.
    const asOf = asOfDate ?? today();
    const accrued = accruedDays(granted, policy.accrualMethod, year, asOf);
    const carriedCounts = carriedOverStillAvailable(grant.carriedOverExpiresOn, asOf);
    const available = roundDays(accrued + (carriedCounts ? carried : 0) - consumed);

    if (requestedDays > available) {
      // The message names the reason the number is smaller than the year's allowance, because
      // "3 remaining" against a 12-day entitlement is otherwise indistinguishable from a bug.
      const because: string[] = [];
      if (accrued < granted) {
        because.push(
          `${accrued} of ${granted} day(s) will have accrued by ${asOf} (earned monthly)`,
        );
      }
      if (carried > 0 && !carriedCounts) {
        because.push(`${carried} carried day(s) lapsed on ${grant.carriedOverExpiresOn}`);
      }
      throw new PreconditionFailedException(
        ErrorCodes.LEAVE_INSUFFICIENT_BALANCE,
        `Not enough ${leaveType} leave: ${requestedDays} day(s) requested, ${available} available ` +
          `for ${year}. Pending requests count against the balance.` +
          (because.length > 0 ? ` (${because.join('; ')}.)` : ''),
      );
    }
  }

  // ── Carry-over ─────────────────────────────────────────────────────────────

  /**
   * Bring unused days from `year - 1` into `year`, capped by each type's policy.
   *
   * IDEMPOTENT BY CONSTRUCTION. It SETS `carried_over_days` from the previous year's closing balance
   * rather than adding to it, so running it twice — or running it again after a late correction to
   * last year — lands on the same answer. An additive run would double every balance the second time
   * somebody clicked the button, which is the kind of mistake nobody notices until March.
   *
   * ONLY UPDATES ROWS THAT ALREADY EXIST for the target year. The new year's grant is HR's decision
   * and this run does not know it, so a missing row is REPORTED rather than invented with a zero
   * grant — which would look like an entitlement of nothing rather than an entitlement not yet set.
   */
  async runCarryOver(
    year: number,
    tx?: DbExecutor,
  ): Promise<{
    applied: { employeeId: string; leaveType: LeaveType; days: number; expiresOn: string | null }[];
    skippedNoTargetRow: { employeeId: string; leaveType: LeaveType; days: number }[];
  }> {
    const executor = tx ?? this.db;
    const policies = await this.policies(tx);
    const previous = year - 1;

    // Everything granted last year, and everything already granted for this one. Two reads rather
    // than a join because the second is a lookup, and because a left join would make "no row for the
    // new year" indistinguishable from "a row with nothing carried".
    const priorGrants = await executor
      .select()
      .from(leaveEntitlements)
      .where(eq(leaveEntitlements.year, previous));
    const targetGrants = await executor
      .select()
      .from(leaveEntitlements)
      .where(eq(leaveEntitlements.year, year));
    const targetKeys = new Set(targetGrants.map((g) => `${g.employeeId}:${g.leaveType}`));

    const applied: {
      employeeId: string;
      leaveType: LeaveType;
      days: number;
      expiresOn: string | null;
    }[] = [];
    const skippedNoTargetRow: { employeeId: string; leaveType: LeaveType; days: number }[] = [];

    for (const prior of priorGrants) {
      const policy = policies.get(prior.leaveType) ?? DEFAULT_POLICY;
      if (policy.carryOverMaxDays <= 0) continue;

      // The prior year's CLOSING balance: it has ended, so the whole grant was earned regardless of
      // accrual method, and anything carried into it either was used or lapsed with it. Carrying a
      // carry-over forward again is what lets a balance compound year on year.
      const consumed = await this.consumedDays(prior.employeeId, prior.leaveType, previous, tx);
      const closing = roundDays(
        Number(prior.grantedDays) + Number(prior.carriedOverDays) - consumed,
      );
      const days = carryOverAmount(closing, policy.carryOverMaxDays);
      if (days <= 0) continue;

      if (!targetKeys.has(`${prior.employeeId}:${prior.leaveType}`)) {
        skippedNoTargetRow.push({
          employeeId: prior.employeeId,
          leaveType: prior.leaveType,
          days,
        });
        continue;
      }

      const expiresOn = carryOverExpiryDate(year, policy.carryOverExpiryMonths);
      await executor
        .update(leaveEntitlements)
        .set({
          carriedOverDays: String(days),
          carriedOverExpiresOn: expiresOn,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leaveEntitlements.employeeId, prior.employeeId),
            eq(leaveEntitlements.leaveType, prior.leaveType),
            eq(leaveEntitlements.year, year),
          ),
        );
      applied.push({
        employeeId: prior.employeeId,
        leaveType: prior.leaveType,
        days,
        expiresOn,
      });
    }

    return { applied, skippedNoTargetRow };
  }
}
