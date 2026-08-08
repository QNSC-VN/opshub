/**
 * Working-day arithmetic for leave.
 *
 * Pure, and deliberately takes the holiday set as an argument rather than loading it: this is the
 * rule that decides what a leave request costs an employee, so it has to be testable over odd
 * inputs (a single day, a weekend-only span, a holiday falling on a Saturday) without a database.
 *
 * DATES ARE CALENDAR DATES, NOT INSTANTS. Every value is a `YYYY-MM-DD` string, parsed and read
 * as UTC — `T00:00:00Z` on the way in, `getUTCDay` on the way out. Parsing and reading in the same
 * frame is what matters: mixing them (local parse, UTC read) shifts the window by a day for anyone
 * off UTC, and that is a request quietly changing cost between a laptop and the deployed task.
 *
 * There is no test asserting timezone independence, and that is deliberate rather than an
 * oversight. A spec that sets `process.env.TZ` mid-run cannot check this: Node resolves the zone
 * once, so the assignment has no effect and the test passes whatever the code does — verified by
 * mutation, where switching this function to local parsing left such a test green. Pinning it
 * would need the whole suite re-run under a second `TZ`, which belongs in CI, not in a spec that
 * claims to prove it.
 */

/**
 * Days of the week that count as working days, as ISO weekday numbers (1 = Monday … 7 = Sunday).
 *
 * Mon–Fri, which is the standard week at QNSC. This is a CONSTANT rather than configuration
 * because there is nowhere to configure it yet — OpsHub has no organisation-settings table. When a
 * second working pattern is needed (a Saturday shift, a different country), this becomes a lookup
 * and every caller already passes through `countWorkingDays`, so there is one place to change.
 */
export const WORKING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * ISO weekday (1 = Monday … 7 = Sunday) of a `YYYY-MM-DD` date, in UTC.
 *
 * Exported for its own test. It has no effect on today's answers — Sunday as JavaScript's `0` or
 * ISO's `7` is absent from `WORKING_WEEKDAYS` either way — which is exactly why it needs pinning
 * directly: adding Sunday to the working set later would otherwise silently do nothing, and the
 * bug would look like a scheduling problem rather than a numbering one.
 */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  // getUTCDay is 0 = Sunday; ISO wants 7.
  return day === 0 ? 7 : day;
}

/** The next calendar date after `date`, as `YYYY-MM-DD`. */
function nextDate(date: string): string {
  const ms = new Date(`${date}T00:00:00Z`).getTime() + 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every calendar date from `start` to `end`, inclusive. */
export function datesInRange(start: string, end: string): string[] {
  if (end < start) return [];
  const out: string[] = [];
  for (let d = start; d <= end; d = nextDate(d)) out.push(d);
  return out;
}

/**
 * How many working days a leave window costs.
 *
 * Inclusive of both ends — a request for the 4th to the 4th is one day, not zero, which is how
 * anyone filing a single day off would read it.
 *
 * Returns 0 for a window made entirely of weekends and holidays. That is a real answer, not an
 * error: the caller decides whether a zero-cost request is worth refusing (it is — see
 * `LeaveBalanceService`), and this function's job is only to count.
 *
 * @param holidays Dates to exclude, as `YYYY-MM-DD`. A holiday already falling on a weekend is
 *                 not double-counted, because each date is considered once.
 */
export function countWorkingDays(
  start: string,
  end: string,
  holidays: ReadonlySet<string> = new Set(),
): number {
  let days = 0;
  for (const date of datesInRange(start, end)) {
    if (!WORKING_WEEKDAYS.includes(isoWeekday(date))) continue;
    if (holidays.has(date)) continue;
    days += 1;
  }
  return days;
}
