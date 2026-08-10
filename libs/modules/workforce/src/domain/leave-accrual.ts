import type { LeaveAccrualMethod } from './workforce.types';

/**
 * Leave accrual and carry-over arithmetic — pure, and deliberately so.
 *
 * WHY NONE OF THIS IS A TABLE
 * ---------------------------
 * Accrued-to-date is a FUNCTION of the grant, the method and the date. Storing it would mean a
 * monthly cron that has to fire on the right morning twelve times a year, and a reconciliation
 * whenever it does not — the same argument the balance service already makes for not storing a
 * balance. Computed on read it cannot drift.
 *
 * The one thing that IS stored is what a carry-over run decided, because that is a decision (how
 * many days were brought forward, and until when) rather than arithmetic anybody can repeat.
 */

/**
 * Days are held as `numeric(5,2)`, so every result is rounded to the same precision.
 *
 * Exactly on the half-cent the direction is whatever the binary float happens to be — `1.005` is
 * stored a hair below the midpoint and rounds DOWN. Left alone deliberately: the quantity is days of
 * leave measured in halves, the error is one hundredth of a day, and decimal arithmetic through the
 * whole balance path would be a large change for a difference nobody can take. What matters is that
 * the value never carries more than two decimals, because `numeric(5,2)` would round it on write and
 * an API figure that disagreed with the stored one is the genuinely confusing outcome.
 */
export function roundDays(days: number): number {
  return Math.round(days * 100) / 100;
}

/**
 * How much of a year's entitlement has been EARNED as of a date.
 *
 * MONTHS ARE EARNED AT THEIR START, not their end: January earns a twelfth on 1 January, and by
 * 1 December the whole year is available. Accruing at month end would leave somebody a twelfth short
 * on 31 December — a balance that is only correct on New Year's Day — and would refuse the last day
 * of December to somebody who had booked nothing all year.
 *
 * A year in the PAST is fully earned regardless of the method: the year finished. A year in the
 * FUTURE has earned nothing, which is what stops next year's allowance being spent this year.
 */
export function accruedDays(
  grantedDays: number,
  method: LeaveAccrualMethod,
  year: number,
  asOf: string,
): number {
  const asOfYear = Number(asOf.slice(0, 4));
  if (asOfYear > year) return roundDays(grantedDays);
  if (asOfYear < year) return 0;
  if (method === 'annual_grant') return roundDays(grantedDays);

  // `YYYY-MM-DD`, so the month is the 6th and 7th characters. Parsed as a string rather than through
  // `Date` for the reason the whole codebase does: no timezone can shift it across a boundary.
  const month = Number(asOf.slice(5, 7));
  return roundDays((grantedDays * month) / 12);
}

/**
 * Whether days carried into a year are still usable.
 *
 * Null means they never expire. The comparison is lexicographic on `YYYY-MM-DD`, which IS
 * chronological in that format — the same rule `assertDateOrder` relies on.
 *
 * INCLUSIVE of the expiry date: days carried "until 30 June" are usable ON 30 June. A window that
 * ended the day before its stated date would be the kind of off-by-one nobody notices until somebody
 * loses a day.
 */
export function carriedOverStillAvailable(expiresOn: string | null, asOf: string): boolean {
  return expiresOn === null || asOf <= expiresOn;
}

/**
 * The date carried days lapse, given the year they were carried INTO.
 *
 * `expiryMonths` counts whole months from 1 January of that year, so 6 gives 30 June — the last day
 * of the sixth month, not the first day of the seventh. Returns null when the policy sets no expiry.
 */
export function carryOverExpiryDate(year: number, expiryMonths: number | null): string | null {
  if (expiryMonths === null) return null;
  // Day 0 of the NEXT month is the last day of this one, which is how February and the 31-day months
  // are handled without a table of month lengths.
  const lastDay = new Date(Date.UTC(year, expiryMonths, 0));
  return lastDay.toISOString().slice(0, 10);
}

/**
 * How many days actually carry, given what was left and what the policy allows.
 *
 * Negative remainders carry NOTHING rather than a negative number: an entitlement reduced below what
 * somebody had already taken is a correction to make, not a debt to push into next year where it
 * would silently reduce an allowance nobody had touched.
 */
export function carryOverAmount(remainingDays: number, maxDays: number): number {
  if (remainingDays <= 0) return 0;
  return roundDays(Math.min(remainingDays, maxDays));
}
