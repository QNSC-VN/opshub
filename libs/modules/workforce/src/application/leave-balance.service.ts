import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  ErrorCodes,
  InjectDrizzle,
  PreconditionFailedException,
  type DbExecutor,
  type DrizzleDB,
} from '@platform';
import { holidays, leaveEntitlements, leaveRequests } from '../../../../../db/schema';
import { countWorkingDays } from '../domain/working-days';
import type { LeaveType } from '../domain/workforce.types';

/** What an employee has, has used, and may still take, for one leave type in one year. */
export interface LeaveBalance {
  leaveType: LeaveType;
  year: number;
  grantedDays: number;
  carriedOverDays: number;
  /** Working days already committed — APPROVED plus still-PENDING requests. */
  consumedDays: number;
  /** granted + carriedOver − consumed. May be negative if an entitlement was reduced. */
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
 */
@Injectable()
export class LeaveBalanceService {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /** Public holidays between two dates, as a set of `YYYY-MM-DD`. */
  async holidaysBetween(start: string, end: string, tx?: DbExecutor): Promise<Set<string>> {
    const rows = await (tx ?? this.db)
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, start), lte(holidays.date, end)));
    return new Set(rows.map((r) => r.date));
  }

  /**
   * Working days a window costs, with the holiday calendar applied.
   *
   * The single place leave cost is computed, so the stored `working_days` on a request and the
   * `consumedDays` in a balance can never disagree about what a day off means.
   */
  async workingDaysFor(start: string, end: string, tx?: DbExecutor): Promise<number> {
    return countWorkingDays(start, end, await this.holidaysBetween(start, end, tx));
  }

  /** Every tracked balance for an employee in a year. */
  async listBalances(employeeId: string, year: number): Promise<LeaveBalance[]> {
    const grants = await this.db
      .select()
      .from(leaveEntitlements)
      .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year)));

    const balances: LeaveBalance[] = [];
    for (const grant of grants) {
      // Read ONCE and reuse. Querying twice would let `consumedDays` and `remainingDays` disagree
      // with each other whenever a request is submitted between the two reads — a row that reports
      // its own arithmetic as inconsistent is worse than either number being slightly stale.
      const consumed = await this.consumedDays(employeeId, grant.leaveType, year);
      const granted = Number(grant.grantedDays);
      const carried = Number(grant.carriedOverDays);
      balances.push({
        leaveType: grant.leaveType,
        year,
        grantedDays: granted,
        carriedOverDays: carried,
        consumedDays: consumed,
        remainingDays: granted + carried - consumed,
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

    const available =
      Number(grant.grantedDays) +
      Number(grant.carriedOverDays) -
      (await this.consumedDays(employeeId, leaveType, year, tx));

    if (requestedDays > available) {
      throw new PreconditionFailedException(
        ErrorCodes.LEAVE_INSUFFICIENT_BALANCE,
        `Not enough ${leaveType} leave: ${requestedDays} day(s) requested, ${available} remaining ` +
          `for ${year}. Pending requests count against the balance.`,
      );
    }
  }
}
