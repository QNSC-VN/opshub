/**
 * Named time constants — use these instead of magic multipliers in application code.
 *
 * Keep arithmetic readable: prefer `7 * MS_PER_DAY` over `604_800_000`.
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
