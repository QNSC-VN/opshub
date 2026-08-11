/**
 * Display formatting for dates, numbers and absent values.
 *
 * WHY THESE ARE NOT INLINE
 * ------------------------
 * `new Date(x).toLocaleDateString()` appeared 25 times across nine pages, and it is wrong in three
 * ways that only show up in production:
 *
 *  1. IT THROWS NOTHING AND SHOWS "Invalid Date" for a null or an empty string. Several call sites
 *     pass a nullable API field straight in, so a record with no date renders that string in the
 *     middle of a table.
 *  2. IT IS LOCALE-DEPENDENT with no locale given, so `03/04` means March in one browser and April
 *     in another. For a leave window or a contract end date, that is not cosmetic.
 *  3. A `date` COLUMN IS NOT AN INSTANT. `workforce.leave_requests.start_date` is a calendar date and
 *     the API returns `YYYY-MM-DD`; `new Date('2026-03-04')` parses that as UTC midnight, which in
 *     any timezone behind UTC renders as the 3rd. The API-level code takes care to parse and read
 *     dates in the same frame (see `working-days.ts`); the SPA was undoing it on the way to the
 *     screen.
 *
 * So: an explicit locale, an em dash for absent values, and `formatDate` treats a bare `YYYY-MM-DD`
 * as the calendar date it is rather than as an instant.
 */

/** What an absent value looks like everywhere in the UI. */
export const EM_DASH = '—';

/**
 * The locale to format in.
 *
 * `en-GB` gives `4 Mar 2026` — unambiguous in a way `03/04/2026` is not, which matters for a product
 * used by people in several countries. Fixed rather than taken from the browser so that a screenshot
 * in a bug report means the same thing as the reporter's screen.
 */
const LOCALE = 'en-GB';

/** True for the `YYYY-MM-DD` a `date` column produces, as opposed to a full timestamp. */
function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * A date for display: `4 Mar 2026`.
 *
 * A bare `YYYY-MM-DD` is formatted from its PARTS, not through the timezone: parsing it as an instant
 * would shift it a day for anybody behind UTC, and a leave request that starts on the 4th must not
 * read as the 3rd because the reader is in Vancouver.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return EM_DASH;

  if (typeof value === 'string' && isCalendarDate(value)) {
    const [year, month, day] = value.split('-').map(Number);
    // `Date.UTC` + a UTC-pinned format keeps the parse frame and the read frame the same.
    return new Intl.DateTimeFormat(LOCALE, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * A timestamp for display: `4 Mar 2026, 14:32`.
 *
 * In the reader's own timezone, deliberately — unlike a calendar date, an instant is a moment that
 * happened, and "when did this get approved" is a question about their clock.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return EM_DASH;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * A `numeric` column for display.
 *
 * The driver hands `numeric` back as a STRING, so these arrive as `'2.50'` and formatting them with
 * `Number()` alone prints `2.5` in one column and `2` in the next. Trailing zeros are dropped and the
 * decimals capped, so half a day of leave reads `2.5` and a whole one reads `2`.
 */
export function formatDecimal(
  value: string | number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return EM_DASH;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(n);
}

/** Anything absent becomes the em dash; anything present is returned unchanged. */
export function orDash<T>(value: T | null | undefined): T | string {
  return value === null || value === undefined || value === '' ? EM_DASH : value;
}

/**
 * Money held in CENTS, as the API stores it.
 *
 * Integer cents in the database and a formatted string at the edge — never a float in between, which
 * is the whole reason the column is an integer. The finops screen had its own `centsToDollars` with a
 * hard-coded `$`; the currency is a parameter here so a second currency does not need a second
 * function.
 *
 * Under the shared `en-GB` locale this prints `US$12.50` rather than `$12.50`, and that is the point:
 * a product used across countries should not leave a bare dollar sign to mean whichever dollar the
 * reader assumes. Same reasoning as the date format.
 */
export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return EM_DASH;
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
