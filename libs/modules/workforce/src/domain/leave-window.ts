import { datesInRange, workingDatesInRange } from './working-days';
import type { LeaveDayPortion } from './workforce.types';

/**
 * What a leave window MEANS, as opposed to what the calendar says.
 *
 * `working-days.ts` answers calendar questions — which dates are in a range, which of them are
 * working days. This file answers the leave questions built on top of them: what a window costs
 * when its ends are half days, and whether two windows actually collide. Kept apart because the
 * calendar rules are shared with anything date-shaped, while these are specific to leave, and
 * because a single file mixing "is Saturday a working day" with "does a morning collide with an
 * afternoon" is the one nobody can find a rule in.
 *
 * A WINDOW RUNS FROM `startDate` AT `startPortion` TO `endDate` AT `endPortion`. There is exactly
 * one spelling for any given window, enforced by CHECKs in migration 0028 and restated as a coded
 * refusal by `leaveWindowViolation` below — a whole day is `full_day`, never morning-to-afternoon;
 * a multi-day window never starts with a lone `morning` or ends with a lone `afternoon`.
 */

/** Half a day, as a fraction of one. The unit part-day leave is booked in. */
export const HALF_DAY = 0.5;

/** Which half of a working day a leave window's boundary falls on. */
export type DayHalf = 'am' | 'pm';

/** A leave window, in the form every rule below takes it. */
export interface LeaveWindow {
  startDate: string;
  endDate: string;
  startPortion: LeaveDayPortion;
  endPortion: LeaveDayPortion;
}

/** A whole-day window, for the callers that do not care about portions. */
export function wholeDays(startDate: string, endDate: string): LeaveWindow {
  return { startDate, endDate, startPortion: 'full_day', endPortion: 'full_day' };
}

/**
 * Why a window is not a legal shape, or null when it is.
 *
 * Returned as a REASON rather than a boolean so the HTTP layer can say which rule was broken.
 * Every case here is also a CHECK in migration 0028 — the CHECK is what makes it true of the
 * table, this is what makes the refusal a 412 with a message instead of a 500 from a constraint
 * violation nobody translated.
 */
export function leaveWindowViolation(window: LeaveWindow): string | null {
  const { startDate, endDate, startPortion, endPortion } = window;
  if (endDate < startDate) return 'startDate must be on or before endDate';

  if (startDate === endDate) {
    if (startPortion !== endPortion) {
      return (
        'A single-day request takes one portion of that day: set startPortion and endPortion to ' +
        'the same value, and use full_day for a whole day rather than morning to afternoon'
      );
    }
    return null;
  }

  if (startPortion === 'morning') {
    return (
      'A window spanning more than one day cannot start with a morning only — leave that begins ' +
      'at midday begins in the afternoon'
    );
  }
  if (endPortion === 'afternoon') {
    return (
      'A window spanning more than one day cannot end with an afternoon only — leave that ends ' +
      'at midday ends with a morning'
    );
  }
  return null;
}

/**
 * Which halves of one date a window covers, empty when the date is outside it.
 *
 * The single place the portion vocabulary is interpreted, which is what keeps the cost and the
 * overlap rule from ever disagreeing about what "afternoon" means. Says nothing about weekends or
 * holidays: a window does cover a Sunday it spans, it simply costs nothing.
 */
export function halvesOn(window: LeaveWindow, date: string): DayHalf[] {
  const { startDate, endDate, startPortion, endPortion } = window;
  if (date < startDate || date > endDate) return [];

  // Interior days are always whole, whatever the ends look like. A single-day window is its own
  // start, and its two portions are equal by the rule above, so `startDate` first covers it.
  const portion = date === startDate ? startPortion : date === endDate ? endPortion : 'full_day';

  if (portion === 'morning') return ['am'];
  if (portion === 'afternoon') return ['pm'];
  return ['am', 'pm'];
}

/**
 * What a window costs, in days, with weekends and public holidays excluded.
 *
 * Counts HALVES and divides, rather than counting whole days and subtracting for the ends. Both
 * give the same answer for a legal window; counting halves also gives the right one for a
 * single-day morning (0.5, not 1 − 0.5 − 0.5 = 0) and cannot go negative, which the subtracting
 * version does the moment a window's two ends are the same day.
 *
 * A part-day boundary falling on a weekend or a holiday costs NOTHING, because the day it is half
 * of costs nothing: an afternoon off on a Sunday is not half a day of leave. That is why the
 * holiday set is applied per date here rather than to the total.
 *
 * @param holidays Dates to exclude, as `YYYY-MM-DD`.
 */
export function leaveWindowCost(
  window: LeaveWindow,
  holidays: ReadonlySet<string> = new Set(),
): number {
  let halves = 0;
  for (const date of workingDatesInRange(window.startDate, window.endDate, holidays)) {
    halves += halvesOn(window, date).length;
  }
  return halves * HALF_DAY;
}

/**
 * Whether two windows take any of the same working half-day.
 *
 * A MORNING AND AN AFTERNOON ON THE SAME DATE DO NOT OVERLAP. Half-day leave is what makes the
 * plain date-range test — `a.start <= b.end AND a.end >= b.start` — too coarse: it would refuse a
 * legitimate morning of annual leave to somebody with a dentist's appointment booked that
 * afternoon, and a refusal that cites an overlap the employee cannot see is worse than no check.
 *
 * The date-range test is still how the CANDIDATES are found in SQL, because it is an index scan
 * and it cannot produce a false negative; this decides the ones it returns.
 *
 * Weekends and holidays are deliberately NOT considered. Two windows both spanning a Sunday do
 * overlap on it — the leave was requested over that date either way, and treating a zero-cost day
 * as unoccupied would let two requests silently claim the same span.
 */
export function leaveWindowsOverlap(a: LeaveWindow, b: LeaveWindow): boolean {
  const from = a.startDate > b.startDate ? a.startDate : b.startDate;
  const to = a.endDate < b.endDate ? a.endDate : b.endDate;
  for (const date of datesInRange(from, to)) {
    const shared = halvesOn(a, date).filter((half) => halvesOn(b, date).includes(half));
    if (shared.length > 0) return true;
  }
  return false;
}
