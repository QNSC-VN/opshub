import { CalendarOff, Info } from 'lucide-react';
import { Badge, humanizeStatus } from '@/shared/ui';
import { formatDate } from '@/shared/lib/format';
import { useHolidays, useLeaveBalances, useLeavePolicies } from './use-leave-admin';

/**
 * What the reader may actually book, and why.
 *
 * WHY TWO NUMBERS AND NOT ONE. `availableDays` is what can be booked NOW — accrued so far, plus unexpired
 * carried days, minus consumed — and it is the figure the API's balance check enforces. `remainingDays` is
 * what the year settles at, which is larger whenever the year is part-accrued or carried days have lapsed.
 * Showing only one of them produces the same support question either way: "why was my request refused when
 * I have days left", or "why does it say I have fewer days than my allowance".
 *
 * CONSUMED COUNTS PENDING, TOO. A request awaiting approval has already spent the days as far as this
 * arithmetic is concerned, which is what stops somebody booking the same week twice while the first sits in
 * an inbox.
 */
export function LeaveBalancePanel({
  employeeId,
  year,
}: {
  /** Omitted for the caller's own balances — the API narrows to the actor without `workforce.read`. */
  employeeId?: string;
  year: number;
}) {
  const balances = useLeaveBalances({ employeeId, year });
  const policies = useLeavePolicies();
  const rows = balances.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {balances.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {balances.isError && <p className="text-sm text-danger">Failed to load the balances.</p>}

      {/* No entitlement row means the type is UNTRACKED, not that it has zero days. Said plainly, because
          "0 days" and "nobody has declared an allowance" are different problems with different fixes. */}
      {!balances.isLoading && !balances.isError && rows.length === 0 && (
        <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          No entitlement declared for {year}, so no leave type is tracked. HR sets an allowance per
          type and year.
        </p>
      )}

      {rows.map((balance) => {
        const policy = policies.data?.find((p) => p.leaveType === balance.leaveType);
        // Carried days that have lapsed are the difference between the two totals, and the reason a
        // reader's own arithmetic disagrees with the screen.
        const lapsed = balance.carriedOverDays > 0 && !balance.carriedOverAvailable;

        return (
          <div
            key={balance.leaveType}
            className="rounded-md border border-border bg-surface px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-fg">
                {humanizeStatus(balance.leaveType)}
              </span>
              <Badge tone="blue">{balance.availableDays} day(s) bookable now</Badge>
              <span className="text-xs text-fg-subtle">
                {balance.remainingDays} left over the year
              </span>
            </div>

            <p className="mt-1 text-xs text-fg-muted">
              {balance.grantedDays} granted · {balance.accruedDays} accrued so far ·{' '}
              {balance.consumedDays} consumed (approved and pending)
              {balance.carriedOverDays > 0 &&
                ` · ${balance.carriedOverDays} carried over${
                  balance.carriedOverExpiresOn
                    ? `, ${lapsed ? 'lapsed' : 'expiring'} ${formatDate(balance.carriedOverExpiresOn)}`
                    : ''
                }`}
            </p>

            {/* The rule, from the API's own policy table: it is the arithmetic's source, not a paraphrase. */}
            {policy && (
              <p className="mt-0.5 text-xs text-fg-subtle">
                Accrues {humanizeStatus(policy.accrualMethod).toLowerCase()} · carry over up to{' '}
                {policy.carryOverMaxDays} day(s), expiring {policy.carryOverExpiryMonths} month(s)
                into the next year
              </p>
            )}

            {lapsed && (
              <p className="mt-0.5 text-xs text-warning">
                Carried days have lapsed, which is why the bookable figure is lower than the yearly
                one.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The public holidays for a year.
 *
 * WHY IT SITS BESIDE THE BALANCES. A holiday is what makes a leave request cost fewer days than it spans, so
 * "why is this five days and not seven" is answered here. Unowned reference data — every employee can read
 * it — and only `workforce.manage` may change it.
 */
export function HolidayList({ year }: { year: number }) {
  const holidays = useHolidays(year);
  const rows = holidays.data ?? [];

  return (
    <div className="flex flex-col gap-1">
      {holidays.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {holidays.isError && <p className="text-xs text-danger">Failed to load the calendar.</p>}

      {!holidays.isLoading && !holidays.isError && rows.length === 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <CalendarOff className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          No holidays declared for {year}, so every weekday counts as a working day.
        </p>
      )}

      {rows.map((holiday) => (
        <div
          key={holiday.id}
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
        >
          <span className="text-xs font-medium text-fg">{formatDate(holiday.date)}</span>
          <span className="text-xs text-fg-muted">{holiday.name}</span>
          {/* `ALL` is the default region, and showing it distinguishes "everywhere" from a site-specific
              day somebody has to interpret. */}
          <Badge tone="neutral">{holiday.region}</Badge>
        </div>
      ))}
    </div>
  );
}
