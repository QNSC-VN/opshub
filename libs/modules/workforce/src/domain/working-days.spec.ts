/**
 * Working-day arithmetic — the rule that decides what a leave request costs.
 *
 * Tested hard and without a database because every one of these cases is a real request someone
 * will file, and an off-by-one here silently gives or takes a day of leave from an employee. The
 * dates below are real 2026 calendar dates: 2026-03-02 is a Monday, 2026-03-07 a Saturday.
 */
import { describe, expect, it } from 'vitest';
import { countWorkingDays, datesInRange, isoWeekday, WORKING_WEEKDAYS } from './working-days';

describe('countWorkingDays', () => {
  it('counts a single working day as one, not zero', () => {
    // Inclusive of both ends: anyone filing one day off reads 4th–4th as one day.
    expect(countWorkingDays('2026-03-04', '2026-03-04')).toBe(1);
  });

  it('counts a full Mon–Fri week as five', () => {
    expect(countWorkingDays('2026-03-02', '2026-03-06')).toBe(5);
  });

  it('excludes the weekend inside a span', () => {
    // Mon 2nd → Mon 9th is eight calendar days, six of them working.
    expect(countWorkingDays('2026-03-02', '2026-03-09')).toBe(6);
  });

  it('returns 0 for a weekend-only span', () => {
    // Sat + Sun. A real answer, not an error — the caller decides what to do with a
    // zero-cost request.
    expect(countWorkingDays('2026-03-07', '2026-03-08')).toBe(0);
  });

  it('excludes a holiday that falls on a working day', () => {
    expect(countWorkingDays('2026-03-02', '2026-03-06', new Set(['2026-03-04']))).toBe(4);
  });

  it('does not double-count a holiday that falls on a weekend', () => {
    // The Saturday was already excluded; naming it a holiday must not subtract a second day.
    expect(countWorkingDays('2026-03-02', '2026-03-09', new Set(['2026-03-07']))).toBe(6);
  });

  it('ignores holidays outside the window', () => {
    expect(countWorkingDays('2026-03-02', '2026-03-06', new Set(['2026-04-01']))).toBe(5);
  });

  it('returns 0 when the range is inverted', () => {
    // An end before the start is refused by validation upstream; counting it as a negative or
    // throwing here would make this function's contract depend on that validation existing.
    expect(countWorkingDays('2026-03-06', '2026-03-02')).toBe(0);
  });

  it('spans a month boundary', () => {
    // Mon 30 Mar → Fri 3 Apr. Proves the day-stepping does not rely on the month.
    expect(countWorkingDays('2026-03-30', '2026-04-03')).toBe(5);
  });

  it('spans a year boundary', () => {
    // Wed 30 Dec 2026 → Tue 5 Jan 2027: excludes Sat 2nd and Sun 3rd.
    expect(countWorkingDays('2026-12-30', '2027-01-05')).toBe(5);
  });

  it('counts a leap day as a working day', () => {
    // 2028-02-29 is a Tuesday. A hand-rolled month-length table is where this breaks.
    expect(countWorkingDays('2028-02-29', '2028-02-29')).toBe(1);
  });
});

describe('datesInRange', () => {
  it('is inclusive of both ends', () => {
    expect(datesInRange('2026-03-02', '2026-03-04')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
  });

  it('is empty for an inverted range', () => {
    expect(datesInRange('2026-03-04', '2026-03-02')).toEqual([]);
  });
});

describe('isoWeekday', () => {
  // Pinned SEPARATELY from countWorkingDays because it cannot be observed through it: Sunday as
  // JavaScript's 0 or ISO's 7 is excluded from WORKING_WEEKDAYS either way, so removing the
  // conversion changes no current answer — proven by mutation, where the whole suite stayed green.
  // Without these two assertions, adding Sunday to the working set later would silently do nothing.
  it('maps Saturday to 6 and Sunday to 7', () => {
    expect(isoWeekday('2026-03-07')).toBe(6);
    expect(isoWeekday('2026-03-08')).toBe(7);
  });

  it('maps Monday to 1 and Friday to 5', () => {
    expect(isoWeekday('2026-03-02')).toBe(1);
    expect(isoWeekday('2026-03-06')).toBe(5);
  });
});

describe('WORKING_WEEKDAYS', () => {
  it('is Mon–Fri in ISO numbering', () => {
    expect(WORKING_WEEKDAYS).toEqual([1, 2, 3, 4, 5]);
  });
});
