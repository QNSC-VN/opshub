/**
 * format — the three ways the inlined `toLocaleDateString()` was wrong.
 *
 * A `.ts` spec: these are pure functions over strings, so no DOM.
 */
import { describe, expect, it } from 'vitest';
import { EM_DASH, formatDate, formatDateTime, formatDecimal, orDash } from './format';

describe('formatDate', () => {
  it('formats a calendar date unambiguously', () => {
    // `4 Mar 2026`, not `03/04/2026` — which means March in one browser and April in another.
    expect(formatDate('2026-03-04')).toBe('4 Mar 2026');
  });

  it('does NOT shift a calendar date across a timezone', () => {
    // The bug this function exists for. `new Date('2026-03-04')` is UTC midnight, so anywhere behind
    // UTC it renders as the 3rd — and a leave request that starts on the 4th must not read as the
    // 3rd because the reader is in Vancouver. Formatted from the parts instead.
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('renders the em dash for absent values rather than "Invalid Date"', () => {
    // Several call sites passed a nullable API field straight in, which put the literal string
    // "Invalid Date" in the middle of a table.
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate(undefined)).toBe(EM_DASH);
    expect(formatDate('')).toBe(EM_DASH);
    expect(formatDate('not a date')).toBe(EM_DASH);
  });

  it('takes a full timestamp or a Date as well', () => {
    expect(formatDate('2026-03-04T22:30:00.000Z')).toMatch(/Mar 2026$/);
    expect(formatDate(new Date(Date.UTC(2026, 2, 4)))).toMatch(/Mar 2026$/);
  });
});

describe('formatDateTime', () => {
  it('includes the time', () => {
    expect(formatDateTime('2026-03-04T14:32:00.000Z')).toMatch(/4 Mar 2026, \d{2}:\d{2}/);
  });

  it('em-dashes an absent or unparseable value', () => {
    expect(formatDateTime(null)).toBe(EM_DASH);
    expect(formatDateTime(undefined)).toBe(EM_DASH);
    expect(formatDateTime('')).toBe(EM_DASH);
    expect(formatDateTime('nonsense')).toBe(EM_DASH);
  });

  it('takes a Date as well as a string', () => {
    // The `instanceof` branch: an API field arrives as a string, but a `new Date()` in a page does not.
    expect(formatDateTime(new Date(Date.UTC(2026, 2, 4, 14, 32)))).toMatch(
      /4 Mar 2026, \d{2}:\d{2}/,
    );
  });
});

describe('formatDecimal', () => {
  it('drops trailing zeros from a numeric column, so a column of days lines up', () => {
    // `numeric` arrives as a STRING: '2.50' and '2.00' must read as 2.5 and 2, not as one of each
    // style depending on which page formatted it.
    expect(formatDecimal('2.50')).toBe('2.5');
    expect(formatDecimal('2.00')).toBe('2');
    expect(formatDecimal(0.5)).toBe('0.5');
  });

  it('keeps a legitimate zero', () => {
    expect(formatDecimal('0.00')).toBe('0');
    expect(formatDecimal(0)).toBe('0');
  });

  it('em-dashes absent and unparseable values', () => {
    expect(formatDecimal(null)).toBe(EM_DASH);
    expect(formatDecimal('')).toBe(EM_DASH);
    expect(formatDecimal('abc')).toBe(EM_DASH);
  });
});

describe('orDash', () => {
  it('passes a present value through untouched, INCLUDING zero and false', () => {
    expect(orDash('x')).toBe('x');
    expect(orDash(0)).toBe(0);
    expect(orDash(false)).toBe(false);
  });

  it('replaces only null, undefined and the empty string', () => {
    expect(orDash(null)).toBe(EM_DASH);
    expect(orDash(undefined)).toBe(EM_DASH);
    expect(orDash('')).toBe(EM_DASH);
  });
});
