import { useEffect, useState } from 'react';

/**
 * How long to wait before a typed search becomes a request.
 *
 * 250 ms is short enough that the results feel immediate and long enough that a word typed at speed is
 * one request rather than five. Named here because two search surfaces share it, and a value that lives
 * in two places drifts.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * `value`, but only after it has stopped changing for `ms`.
 *
 * WHY THIS IS SHARED. `EntityPicker` had this as an inline effect with the reasoning written beside it —
 * "every keystroke is a request otherwise, and a directory search is not free" — while the command
 * palette had a docblock claiming "debounced 250 ms" and no debounce at all. Two live queries fired per
 * keystroke past two characters there, so an eleven-character search was twenty requests to
 * `/v1/employees` and `/v1/assets`, both of which are paged database reads.
 *
 * The two surfaces search the same endpoints for the same reason, so they now share one implementation
 * rather than one having it and the other only claiming to.
 */
export function useDebounced<T>(value: T, ms: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    // Cleared on every change, which is what makes it a debounce rather than a throttle: the timer
    // restarts while the user is still typing and only fires once they pause.
    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}
