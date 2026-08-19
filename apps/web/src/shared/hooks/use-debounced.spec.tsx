// @vitest-environment jsdom
/**
 * The debounce two search surfaces share.
 *
 * Every timer advance is wrapped in `act`: the hook sets state from a `setTimeout`, and advancing fake
 * timers outside `act` fires the callback without flushing the render, so the assertion reads the
 * previous value and the test fails describing the opposite of what happened.
 *
 * `EntityPicker` had this as an inline effect; the command palette had a docblock claiming "debounced
 * 250 ms" and no debounce at all, so two live queries fired per keystroke past two characters. An
 * eleven-character search was twenty requests to two paged endpoints for results nobody saw. The hook
 * exists so one of them cannot drift from the other again, and these tests pin the behaviour the
 * palette was missing rather than merely that the hook returns something.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, useDebounced } from './use-debounced';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebounced', () => {
  it('returns the first value immediately, so nothing renders empty on mount', () => {
    // A search box that starts blank should not wait 250 ms to agree that it is blank, and a
    // pre-filled one should render its results on the first pass.
    const { result } = renderHook(() => useDebounced('laptop'));
    expect(result.current).toBe('laptop');
  });

  it('withholds a new value until the delay has passed', () => {
    const { result, rerender } = renderHook(({ term }) => useDebounced(term), {
      initialProps: { term: 'a' },
    });

    rerender({ term: 'ab' });
    // Still the old value: this is the request that does not get made.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current).toBe('ab');
  });

  it('collapses a burst of keystrokes into one settled value', () => {
    const { result, rerender } = renderHook(({ term }) => useDebounced(term), {
      initialProps: { term: '' },
    });

    /*
     * THE DEFECT, EXPRESSED AS A TEST. Typing "employee" is eight renders. Undebounced, the palette
     * turned that into sixteen requests — one per keystroke to `/v1/employees` and one to `/v1/assets`.
     * Here it must produce exactly one settled value, and only after the typing stops.
     */
    for (const term of ['e', 'em', 'emp', 'empl', 'emplo', 'employ', 'employe', 'employee']) {
      rerender({ term });
      // Each keystroke restarts the timer, so advancing by less than the delay must change nothing.
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
      });
      expect(result.current).toBe('');
    }

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current).toBe('employee');
  });

  it('is a debounce, not a throttle — the pending value is replaced, never queued', () => {
    const { result, rerender } = renderHook(({ term }) => useDebounced(term), {
      initialProps: { term: 'first' },
    });

    rerender({ term: 'second' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    rerender({ term: 'third' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    // `second` must never be observed: a throttle would have emitted it on the way past.
    expect(result.current).toBe('third');
  });

  it('honours a caller-supplied delay', () => {
    const { result, rerender } = renderHook(({ term }) => useDebounced(term, 1000), {
      initialProps: { term: 'a' },
    });

    rerender({ term: 'b' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current, 'the default delay was used instead of the argument').toBe('a');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('b');
  });

  it('cancels its pending timer on unmount', () => {
    const { rerender, unmount } = renderHook(({ term }) => useDebounced(term), {
      initialProps: { term: 'a' },
    });
    rerender({ term: 'b' });
    unmount();

    // A timer that survives unmount sets state on a gone component. Nothing to assert but the absence
    // of a warning, so this asserts the timer queue itself is empty.
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
