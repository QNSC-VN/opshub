/**
 * Leave accrual arithmetic.
 *
 * These are pure functions, so this is where the awkward cases belong: month boundaries, leap years,
 * a year in the past, a negative remainder. The e2e suite proves the API applies them; nothing there
 * can cheaply enumerate twelve months.
 */
import { describe, expect, it } from 'vitest';
import {
  accruedDays,
  carriedOverStillAvailable,
  carryOverAmount,
  carryOverExpiryDate,
  roundDays,
} from './leave-accrual';

describe('accruedDays', () => {
  it('gives the whole grant on 1 January under annual_grant', () => {
    // Somebody who falls ill in January has not earned less sick leave than somebody who falls ill in
    // December, which is the reason the method exists.
    expect(accruedDays(12, 'annual_grant', 2026, '2026-01-01')).toBe(12);
  });

  it('earns a twelfth per month, at the START of the month', () => {
    // Months are earned when they begin. Accruing at month END would leave somebody a twelfth short
    // on 31 December — a balance only correct on New Year's Day.
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-01-01')).toBe(1);
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-01-31')).toBe(1);
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-02-01')).toBe(2);
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-08-11')).toBe(8);
  });

  it('reaches the full grant in December, not in January of the next year', () => {
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-12-01')).toBe(12);
    expect(accruedDays(12, 'monthly_accrual', 2026, '2026-12-31')).toBe(12);
  });

  it('rounds a grant that does not divide by twelve', () => {
    // 15 days is a real entitlement and 15/12 is 1.25. The column is `numeric(5,2)`, so the function
    // rounds to the same precision the database will store.
    expect(accruedDays(15, 'monthly_accrual', 2026, '2026-01-15')).toBe(1.25);
    expect(accruedDays(15, 'monthly_accrual', 2026, '2026-07-01')).toBe(8.75);
    expect(accruedDays(15, 'monthly_accrual', 2026, '2026-12-01')).toBe(15);
  });

  it('treats a finished year as fully earned, whatever the method', () => {
    // The year ended: nobody can earn any more of it, and nobody earned less than all of it.
    expect(accruedDays(12, 'monthly_accrual', 2025, '2026-08-11')).toBe(12);
  });

  it('treats a future year as earning nothing', () => {
    // What stops next year's allowance being spent this year.
    expect(accruedDays(12, 'monthly_accrual', 2027, '2026-08-11')).toBe(0);
    expect(accruedDays(12, 'annual_grant', 2027, '2026-08-11')).toBe(0);
  });

  it('handles a zero grant without inventing days', () => {
    expect(accruedDays(0, 'monthly_accrual', 2026, '2026-08-11')).toBe(0);
  });
});

describe('carriedOverStillAvailable', () => {
  it('treats a null expiry as never lapsing', () => {
    expect(carriedOverStillAvailable(null, '2099-12-31')).toBe(true);
  });

  it('is INCLUSIVE of the expiry date', () => {
    // Days carried "until 30 June" are usable ON 30 June. The off-by-one nobody notices until
    // somebody loses a day.
    expect(carriedOverStillAvailable('2026-06-30', '2026-06-30')).toBe(true);
    expect(carriedOverStillAvailable('2026-06-30', '2026-07-01')).toBe(false);
  });

  it('compares as strings, so no timezone can shift it', () => {
    expect(carriedOverStillAvailable('2026-06-30', '2026-06-29')).toBe(true);
  });
});

describe('carryOverExpiryDate', () => {
  it('gives the LAST day of the nth month', () => {
    // Six months means "through June", not "until 1 July".
    expect(carryOverExpiryDate(2026, 6)).toBe('2026-06-30');
    expect(carryOverExpiryDate(2026, 1)).toBe('2026-01-31');
    expect(carryOverExpiryDate(2026, 12)).toBe('2026-12-31');
  });

  it('gets February right in both a leap year and a common one', () => {
    // Handled by asking for day 0 of the next month rather than carrying a table of month lengths.
    expect(carryOverExpiryDate(2026, 2)).toBe('2026-02-28');
    expect(carryOverExpiryDate(2028, 2)).toBe('2028-02-29');
  });

  it('returns null when the policy sets no expiry', () => {
    expect(carryOverExpiryDate(2026, null)).toBeNull();
  });
});

describe('carryOverAmount', () => {
  it('caps at the policy maximum', () => {
    expect(carryOverAmount(9, 5)).toBe(5);
    expect(carryOverAmount(3, 5)).toBe(3);
  });

  it('carries nothing from a negative remainder', () => {
    // An entitlement reduced below what was already taken is a correction to make, not a debt to push
    // into next year where it would silently reduce an allowance nobody had touched.
    expect(carryOverAmount(-4, 5)).toBe(0);
  });

  it('carries nothing when the policy allows nothing', () => {
    expect(carryOverAmount(9, 0)).toBe(0);
  });

  it('keeps half days', () => {
    expect(carryOverAmount(2.5, 5)).toBe(2.5);
  });
});

describe('roundDays', () => {
  it('rounds to the two decimals the column stores', () => {
    expect(roundDays(8.749999)).toBe(8.75);
    expect(roundDays(1.004)).toBe(1);
    expect(roundDays(1.006)).toBe(1.01);
  });

  it('does NOT promise a direction exactly on the half-cent', () => {
    // `1.005` has no exact binary representation and is stored a hair BELOW the midpoint, so
    // `Math.round(100.4999…)` is 100 and the result is `1`, not `1.01`. This test asserts the real
    // behaviour rather than a tidier claim, because the tidier claim is false.
    //
    // Left alone deliberately: the quantity is days of leave, measured in halves, and the error is
    // one hundredth of a day. Chasing it would mean decimal arithmetic through the whole balance
    // path for a difference nobody can take. What DOES matter is that the value never carries more
    // than two decimals, since `numeric(5,2)` would round it on write anyway and a mismatch between
    // the API's figure and the stored one is the confusing outcome.
    expect(roundDays(1.005)).toBe(1);
    for (const n of [1.005, 2.675, 8.335, 0.125]) {
      expect(Math.abs(roundDays(n) - n)).toBeLessThanOrEqual(0.01);
      expect(String(roundDays(n)).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });
});
