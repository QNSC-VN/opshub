import { describe, expect, it } from 'vitest';
import { latestDateAnywhere, today } from './index';

/**
 * The two notions of "today", and why both exist.
 *
 * `today()` is UTC and correct for the system's own arithmetic. `latestDateAnywhere()` is for validating a
 * date a PERSON typed, because a browser east of UTC calls tomorrow "today" for up to fourteen hours — which
 * is how a training completion recorded on the day it happened came back as
 * `TRAINING_INVALID_COMPLETION: cannot be dated in the future`.
 */
describe('latestDateAnywhere', () => {
  it('is already tomorrow when UTC is late in the day', () => {
    // 22:00 UTC is 05:00 in UTC+7 the NEXT day, so that caller's "today" is the 2nd.
    const now = new Date('2026-08-01T22:00:00.000Z');
    expect(today(now)).toBe('2026-08-01');
    expect(latestDateAnywhere(now)).toBe('2026-08-02');
  });

  it('agrees with UTC early in the day, so it never widens the window by two days', () => {
    const now = new Date('2026-08-01T02:00:00.000Z');
    expect(latestDateAnywhere(now)).toBe('2026-08-01');
  });

  it('never allows more than one day past UTC, whatever the hour', () => {
    // The bound is what keeps this a timezone allowance rather than a hole: UTC+14 is the real maximum.
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 7, 1, hour));
      const allowed = latestDateAnywhere(now);
      expect([today(now), '2026-08-02']).toContain(allowed);
    }
  });
});
