import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, isoDaysFromNow, isoInstantFromDate, todayIso } from './format';

/**
 * The date helpers, pinned at the boundary where they used to be wrong.
 *
 * These three exist because six screens built the same expression by hand and one of them drifted. The
 * cases below are the ones a hand-written version gets wrong: a timezone behind UTC, a month boundary,
 * and the round trip from a date input back to a displayed date.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe('todayIso', () => {
  it("answers in the READER'S timezone, not UTC", () => {
    // 01:30 UTC on the 12th is still the 11th anywhere in the Americas. `toISOString().slice(0, 10)` —
    // the expression this replaced — answers the UTC day, so it hands a form the 12th while the reader's
    // calendar says the 11th.
    //
    // Checked against `en-CA`, which formats as `YYYY-MM-DD` in the LOCAL zone: an independent oracle, so
    // the assertion holds whatever TZ the suite runs under and FAILS for a UTC-based implementation in
    // any zone behind Greenwich. Run `TZ=America/Vancouver npx vitest run src/shared/lib` to see that.
    vi.useFakeTimers();
    const now = new Date('2026-08-12T01:30:00Z');
    vi.setSystemTime(now);
    expect(todayIso()).toBe(new Intl.DateTimeFormat('en-CA').format(now));
  });

  it('pads a single-digit month and day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T12:00:00Z'));
    expect(todayIso()).toBe('2026-03-04');
  });
});

describe('isoDaysFromNow', () => {
  it('crosses a month boundary by calendar, not by 30-day arithmetic', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T12:00:00Z'));
    expect(isoDaysFromNow(1)).toBe('2026-02-01');
    expect(isoDaysFromNow(29)).toBe('2026-03-01'); // 2026 is not a leap year
    expect(isoDaysFromNow(-31)).toBe('2025-12-31');
  });

  it('is today at zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
    expect(isoDaysFromNow(0)).toBe(todayIso());
  });
});

describe('isoInstantFromDate', () => {
  it('round-trips through formatDate as the SAME calendar day', () => {
    // The property that matters: pick a day in a form, read it back on a screen, get that day. Midnight
    // fails this for every reader west of Greenwich, which is how a signature date lands a day early.
    for (const day of ['2026-08-11', '2026-01-01', '2026-12-31']) {
      expect(formatDate(isoInstantFromDate(day))).toBe(formatDate(day));
    }
  });

  it('is an instant, which is what a timestamptz field accepts', () => {
    expect(isoInstantFromDate('2026-08-11')).toMatch(/^2026-08-1[01]T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('gives an empty string for an empty or unparseable input', () => {
    expect(isoInstantFromDate('')).toBe('');
    expect(isoInstantFromDate('not-a-date')).toBe('');
  });

  it('sends TODAY as now, so it never predates something recorded earlier today', () => {
    // The bug this exists to stop: a non-conformance detected at 14:35 could not be contained "today",
    // because midday today is 14:35's past and the API refuses containment that predates detection.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T14:35:00'));
    const detectedAt = new Date().toISOString();

    vi.setSystemTime(new Date('2026-03-04T16:00:00'));
    const containedAt = isoInstantFromDate(todayIso());

    expect(containedAt >= detectedAt).toBe(true);
    // Still the same calendar day, which is what the form's reader chose.
    expect(formatDate(containedAt)).toBe(formatDate(todayIso()));
  });

  it('still sends midday for a day that is not today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T16:00:00'));
    // Midday LOCAL, so reading it back anywhere within twelve hours gives the day that was picked.
    expect(formatDate(isoInstantFromDate('2026-03-01'))).toBe(formatDate('2026-03-01'));
    expect(isoInstantFromDate('2026-03-01')).not.toBe(new Date().toISOString());
  });
});
