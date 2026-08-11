/**
 * useListState — the search term and page offset every list page needs, in one place.
 *
 * WHY A HOOK AND NOT TWO `useState` CALLS
 * --------------------------------------
 * Because of one rule that is easy to forget and invisible when wrong: CHANGING THE SEARCH MUST
 * RESET THE OFFSET. Type a term while on page 4 and the request asks for rows 60–80 of a result
 * set that now has three, so the table comes back empty and the page looks broken. Every existing
 * OpsHub list page avoids the bug by not paginating at all — they request `limit: 100` and show a
 * total, which silently truncates any list with more than a hundred rows.
 *
 * The offset is also reset by any FILTER change, which is why `resetPaging` is returned: a filter
 * lives in the page (it is different per resource) and has the same effect on the result set.
 */
import { useCallback, useMemo, useState } from 'react';

/** Rows per page. 25 fits a laptop viewport without scrolling the header away. */
export const DEFAULT_PAGE_SIZE = 25;

export interface ListState {
  /** Bind to the toolbar search input. */
  search: string;
  /** Sets the term AND returns to the first page — see the docblock. */
  setSearch: (term: string) => void;
  limit: number;
  offset: number;
  /** 1-based, for display only. */
  page: number;
  /** Call from a filter's onChange so the same reset applies. */
  resetPaging: () => void;
  goToOffset: (offset: number) => void;
}

export function useListState(pageSize: number = DEFAULT_PAGE_SIZE): ListState {
  const [search, setSearchRaw] = useState('');
  const [offset, setOffset] = useState(0);

  const setSearch = useCallback((term: string) => {
    setSearchRaw(term);
    setOffset(0);
  }, []);

  const resetPaging = useCallback(() => setOffset(0), []);

  return useMemo(
    () => ({
      search,
      setSearch,
      limit: pageSize,
      offset,
      page: Math.floor(offset / pageSize) + 1,
      resetPaging,
      goToOffset: setOffset,
    }),
    [search, setSearch, pageSize, offset, resetPaging],
  );
}
