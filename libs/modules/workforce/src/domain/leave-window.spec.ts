/**
 * Part-day leave semantics.
 *
 * Pure functions, so this is where the combinations belong: every portion pairing, a boundary half
 * day falling on a weekend, two windows sharing a date but not a half. The e2e suite proves the API
 * applies these; it cannot cheaply enumerate the grid.
 */
import { describe, expect, it } from 'vitest';
import {
  HALF_DAY,
  halvesOn,
  leaveWindowCost,
  leaveWindowsOverlap,
  leaveWindowViolation,
  wholeDays,
  type LeaveWindow,
} from './leave-window';

/** 2031-03-03 is a Monday, so this whole week is Mon–Fri unless a test says otherwise. */
const MON = '2031-03-03';
const WED = '2031-03-05';
const FRI = '2031-03-07';
const SAT = '2031-03-08';
const SUN = '2031-03-09';
/** The Monday AFTER that weekend — a window running Saturday to `MON` would run backwards. */
const NEXT_MON = '2031-03-10';

function window(
  startDate: string,
  endDate: string,
  startPortion: LeaveWindow['startPortion'] = 'full_day',
  endPortion: LeaveWindow['endPortion'] = 'full_day',
): LeaveWindow {
  return { startDate, endDate, startPortion, endPortion };
}

describe('leaveWindowViolation', () => {
  it('accepts a whole-day window of any length', () => {
    expect(leaveWindowViolation(wholeDays(MON, MON))).toBeNull();
    expect(leaveWindowViolation(wholeDays(MON, FRI))).toBeNull();
  });

  it('accepts a single day taken as one half', () => {
    expect(leaveWindowViolation(window(MON, MON, 'morning', 'morning'))).toBeNull();
    expect(leaveWindowViolation(window(MON, MON, 'afternoon', 'afternoon'))).toBeNull();
  });

  it('refuses morning-to-afternoon, because that is what full_day is for', () => {
    // Two spellings for one window is what lets two rows that mean the same thing compare as
    // different.
    expect(leaveWindowViolation(window(MON, MON, 'morning', 'afternoon'))).toMatch(/full_day/);
    // …and the mirror image, which reads as a day that starts whole and ends half.
    expect(leaveWindowViolation(window(MON, MON, 'full_day', 'morning'))).toMatch(/same value/);
  });

  it('accepts a window that begins after lunch and ends before it', () => {
    // The shape part-day leave exists for: Wednesday afternoon through Friday morning.
    expect(leaveWindowViolation(window(WED, FRI, 'afternoon', 'morning'))).toBeNull();
  });

  it('refuses a multi-day window that starts with a lone morning', () => {
    // "Morning" means the morning is all that is taken, which a window continuing into the next
    // day contradicts.
    expect(leaveWindowViolation(window(MON, WED, 'morning', 'full_day'))).toMatch(/afternoon/);
  });

  it('refuses a multi-day window that ends with a lone afternoon', () => {
    expect(leaveWindowViolation(window(MON, WED, 'full_day', 'afternoon'))).toMatch(/morning/);
  });

  it('refuses dates that run backwards', () => {
    expect(leaveWindowViolation(wholeDays(FRI, MON))).toMatch(/on or before/);
  });
});

describe('halvesOn', () => {
  it('gives both halves of an interior day, whatever the ends are', () => {
    expect(halvesOn(window(MON, FRI, 'afternoon', 'morning'), WED)).toEqual(['am', 'pm']);
  });

  it('gives one half at a part-day boundary', () => {
    const w = window(WED, FRI, 'afternoon', 'morning');
    expect(halvesOn(w, WED)).toEqual(['pm']);
    expect(halvesOn(w, FRI)).toEqual(['am']);
  });

  it('gives one half for a single-day part-day window', () => {
    expect(halvesOn(window(MON, MON, 'morning', 'morning'), MON)).toEqual(['am']);
    expect(halvesOn(window(MON, MON, 'afternoon', 'afternoon'), MON)).toEqual(['pm']);
  });

  it('gives nothing for a date outside the window', () => {
    expect(halvesOn(wholeDays(WED, FRI), MON)).toEqual([]);
    expect(halvesOn(wholeDays(MON, WED), FRI)).toEqual([]);
  });

  it('covers a weekend it spans — costing nothing is not the same as being outside', () => {
    // The cost rule is what excludes weekends. Conflating the two here would make two requests
    // over the same weekend look like they did not collide.
    expect(halvesOn(wholeDays(FRI, SUN), SAT)).toEqual(['am', 'pm']);
  });
});

describe('leaveWindowCost', () => {
  it('charges a half day for a lone morning or afternoon', () => {
    expect(leaveWindowCost(window(MON, MON, 'morning', 'morning'))).toBe(HALF_DAY);
    expect(leaveWindowCost(window(MON, MON, 'afternoon', 'afternoon'))).toBe(HALF_DAY);
  });

  it('charges a whole day for a whole day', () => {
    expect(leaveWindowCost(wholeDays(MON, MON))).toBe(1);
    expect(leaveWindowCost(wholeDays(MON, FRI))).toBe(5);
  });

  it('charges 2 for Wednesday afternoon through Friday morning', () => {
    // Half of Wednesday, all of Thursday, half of Friday.
    expect(leaveWindowCost(window(WED, FRI, 'afternoon', 'morning'))).toBe(2);
  });

  it('charges nothing for a part-day end that falls on a weekend', () => {
    // An afternoon off on a Sunday is not half a day of leave, because the day it is half of costs
    // nothing.
    expect(leaveWindowCost(window(SUN, SUN, 'afternoon', 'afternoon'))).toBe(0);
    // Saturday afternoon to Monday morning is half a day: only Monday's morning counts.
    expect(leaveWindowCost(window(SAT, NEXT_MON, 'afternoon', 'morning'))).toBe(HALF_DAY);
  });

  it('charges nothing for a part-day end that falls on a public holiday', () => {
    expect(leaveWindowCost(window(MON, MON, 'morning', 'morning'), new Set([MON]))).toBe(0);
    // …and the rest of the window is unaffected: Tue–Thu whole, Friday morning, Monday excluded.
    expect(leaveWindowCost(window(MON, FRI, 'full_day', 'morning'), new Set([MON]))).toBe(3.5);
  });

  it('never goes negative, even where subtracting for the ends would', () => {
    // The reason cost counts halves upward instead of counting days and deducting: on a single day
    // "1 − 0.5 − 0.5" is 0, and on a holiday it is −1.
    expect(leaveWindowCost(window(MON, MON, 'morning', 'morning'))).toBeGreaterThan(0);
    expect(leaveWindowCost(window(SAT, SUN, 'afternoon', 'morning'))).toBe(0);
  });

  it('is always a whole number of half days, which the table also checks', () => {
    for (const w of [
      window(MON, MON, 'morning', 'morning'),
      window(WED, FRI, 'afternoon', 'morning'),
      wholeDays(MON, FRI),
      window(MON, FRI, 'afternoon', 'morning'),
    ]) {
      expect(leaveWindowCost(w) % HALF_DAY).toBe(0);
    }
  });
});

describe('leaveWindowsOverlap', () => {
  it('sees a plain collision', () => {
    expect(leaveWindowsOverlap(wholeDays(MON, WED), wholeDays(WED, FRI))).toBe(true);
    expect(leaveWindowsOverlap(wholeDays(MON, FRI), wholeDays(WED, WED))).toBe(true);
  });

  it('does NOT collide a morning with an afternoon on the same date', () => {
    // The whole reason the date-range test is no longer the answer: refusing this would refuse
    // leave the employee can see is free.
    expect(
      leaveWindowsOverlap(
        window(MON, MON, 'morning', 'morning'),
        window(MON, MON, 'afternoon', 'afternoon'),
      ),
    ).toBe(false);
  });

  it('collides two windows that share the same half', () => {
    expect(
      leaveWindowsOverlap(
        window(MON, MON, 'morning', 'morning'),
        window(MON, MON, 'morning', 'morning'),
      ),
    ).toBe(true);
  });

  it('lets one window end at midday and the next begin after it', () => {
    // Monday to Wednesday morning, then Wednesday afternoon to Friday: touching, not overlapping.
    expect(
      leaveWindowsOverlap(
        window(MON, WED, 'full_day', 'morning'),
        window(WED, FRI, 'afternoon', 'full_day'),
      ),
    ).toBe(false);
  });

  it('collides a part-day boundary with a whole day on the same date', () => {
    expect(leaveWindowsOverlap(window(MON, WED, 'full_day', 'morning'), wholeDays(WED, FRI))).toBe(
      true,
    );
  });

  it('sees no collision between windows that do not touch', () => {
    expect(leaveWindowsOverlap(wholeDays(MON, WED), wholeDays(FRI, FRI))).toBe(false);
  });

  it('is symmetric', () => {
    const a = window(MON, WED, 'full_day', 'morning');
    const b = window(WED, FRI, 'afternoon', 'full_day');
    expect(leaveWindowsOverlap(a, b)).toBe(leaveWindowsOverlap(b, a));
    const c = wholeDays(WED, FRI);
    expect(leaveWindowsOverlap(a, c)).toBe(leaveWindowsOverlap(c, a));
  });

  it('collides on a weekend the two windows share', () => {
    // Zero-cost days are still occupied — treating them as free would let two requests claim the
    // same span.
    expect(leaveWindowsOverlap(wholeDays(FRI, SAT), wholeDays(SAT, NEXT_MON))).toBe(true);
  });
});
