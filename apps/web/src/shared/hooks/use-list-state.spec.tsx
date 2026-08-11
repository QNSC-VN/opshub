// @vitest-environment jsdom
/**
 * useListState — one rule, and it is the one that is invisible when broken.
 *
 * A pure-state hook, so it is driven through React's own act loop with a component that renders
 * nothing — there is no markup to assert on, only the state the rule governs.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, useListState, type ListState } from './use-list-state';

/**
 * Drive the hook and expose its latest value.
 *
 * Hand-rolled rather than `renderHook`, because what these tests assert is the value AFTER an
 * update — and reading it through a closure keeps each assertion about the state itself rather than
 * about a rerender count.
 */
function harness(pageSize?: number): { current: () => ListState } {
  let latest: ListState | undefined;
  function Probe() {
    latest = useListState(pageSize);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  return {
    current: () => {
      if (!latest) throw new Error('hook never ran');
      return latest;
    },
  };
}

describe('useListState', () => {
  it('starts on the first page with the default size', () => {
    const h = harness();
    expect(h.current()).toMatchObject({ search: '', offset: 0, page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it('RESETS the offset when the search changes', () => {
    // The bug this hook exists to prevent: type a term while on page 4 and the request asks for
    // rows 75–100 of a result set that now has three, so the table comes back empty and the screen
    // looks broken.
    const h = harness();
    act(() => h.current().goToOffset(75));
    expect(h.current().page).toBe(4);

    act(() => h.current().setSearch('qa'));
    expect(h.current().offset).toBe(0);
    expect(h.current().page).toBe(1);
    expect(h.current().search).toBe('qa');
  });

  it('resets the offset for a filter change too', () => {
    // Same effect on the result set, so the same reset — exposed because a filter lives in the page.
    const h = harness();
    act(() => h.current().goToOffset(50));
    act(() => h.current().resetPaging());
    expect(h.current().offset).toBe(0);
  });

  it('derives the 1-based page from the offset and the size', () => {
    const h = harness(10);
    act(() => h.current().goToOffset(0));
    expect(h.current().page).toBe(1);
    act(() => h.current().goToOffset(10));
    expect(h.current().page).toBe(2);
    act(() => h.current().goToOffset(95));
    expect(h.current().page).toBe(10);
  });

  it('takes a custom page size', () => {
    expect(harness(50).current().limit).toBe(50);
  });
});
