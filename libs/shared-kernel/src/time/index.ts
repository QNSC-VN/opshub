/**
 * Named time constants and ISO-date-string arithmetic.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. NO MAGIC MULTIPLIERS in application code. Prefer `7 * MS_PER_DAY` over `604_800_000`, and
 *    `24 * MS_PER_HOUR` over `24 * 60 * 60 * 1000`. The constant is not shorter; it is checkable.
 *
 * 2. DATES ARE `YYYY-MM-DD` STRINGS, compared as strings. In that format lexicographic order IS
 *    chronological order, so there is no parsing, no timezone, and no off-by-one-day from a
 *    `new Date('2026-03-01')` comparison in a UTC+7 process. Every date CHECK in the schema uses
 *    `>=` on a `date` column, and `assertDateOrder` in `@platform` fronts those with a coded refusal.
 *    The helpers below are the only place that turns a `Date` into that string.
 */

/** One second in milliseconds */
export const MS_PER_SEC = 1_000;
/** One minute in milliseconds */
export const MS_PER_MIN = 60_000;
/** One hour in milliseconds */
export const MS_PER_HOUR = 3_600_000;
/** One day in milliseconds */
export const MS_PER_DAY = 86_400_000;

/** One day in seconds (for cache TTL APIs that accept seconds, e.g. Redis SET EX) */
export const SEC_PER_DAY = 86_400;
/** One hour in seconds */
export const SEC_PER_HOUR = 3_600;

/**
 * Today as `YYYY-MM-DD` in UTC.
 *
 * Takes `now` so callers can pass a fixed clock in tests instead of mocking `Date`. Lived as three
 * identical private copies — in contracts, the risk register and training — before it moved here.
 */
export function today(now: Date = new Date()): string {
  return toIsoDate(now);
}

/**
 * The latest calendar date that is "today" SOMEWHERE on Earth, as `YYYY-MM-DD`.
 *
 * WHY A SECOND NOTION OF TODAY. A user-supplied date is a date in THEIR timezone, and the API only knows
 * UTC. At 01:00 in UTC+7 the browser's "today" is already tomorrow in UTC, so a plain
 * `date > today()` check rejects a completion somebody is recording on the day it happened — measured, at
 * 01:54 local, as a 412 `TRAINING_INVALID_COMPLETION` for a form whose date field defaulted to today.
 *
 * UTC+14 IS THE REAL MAXIMUM (Kiribati), so this is the widest date any caller can honestly call today.
 * Use it for validating a date a PERSON typed. Do NOT use it for computing due dates or windows: those are
 * the system's own arithmetic and belong in UTC, where `today()` is correct.
 */
export function latestDateAnywhere(now: Date = new Date()): string {
  return toIsoDate(new Date(now.getTime() + 14 * MS_PER_HOUR));
}

/** A `Date` as `YYYY-MM-DD` in UTC. The one place that conversion happens. */
export function toIsoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, both ISO dates. Negative when `to` precedes `from`.
 *
 * Lived as a private function at the bottom of `contracts.service.ts` until a second caller needed it —
 * which is the moment a private date helper becomes two subtly different date helpers.
 */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / MS_PER_DAY);
}

/** `days` after `from`, as `YYYY-MM-DD`. */
export function addDays(from: string, days: number): string {
  const d = parseIsoDate(from);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/**
 * `from` plus `months`, as `YYYY-MM-DD`, CLAMPED to the end of the target month.
 *
 * Months rather than days because certifications, retention periods and review cadences are all
 * stated in months and `n × 30` drifts. The clamp is the part worth stating: `2026-01-31` plus one
 * month has no 31st to land on, and JavaScript's `setUTCMonth` silently rolls forward into March. A
 * certificate earned on the 31st should lapse on the last day of the month it lapses in, not three
 * days later.
 *
 * NOTE this differs from Postgres's `+ interval '1 month'`, which clamps the same way — they agree.
 * What does NOT agree is a bare `setUTCMonth`, which is why that spelling should not appear anywhere.
 */
export function addMonths(from: string, months: number): string {
  const start = parseIsoDate(from);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = start.getUTCDate();
  const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(year, month, Math.min(day, lastOfTarget))));
}

/** `YYYY-MM-DD` as a UTC `Date` at midnight. Explicit `T00:00:00Z` so the host zone cannot shift it. */
function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
