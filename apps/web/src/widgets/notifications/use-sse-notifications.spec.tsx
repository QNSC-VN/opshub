// @vitest-environment jsdom
/**
 * The unread badge, when the stream is not there.
 *
 * WHAT THIS PINS. `unreadCount` started at zero and was only ever set by the SSE `connected` event — so a
 * stream that could not be opened left a user with unread notifications looking at a clean bell, stating
 * "nothing new" with confidence. A proxy that blocks `text/event-stream`, an offline moment, a 500 on the
 * stream route: each produced that. The API's own SSE controller already said what to do — "call
 * GET /notifications/unread-count to reconcile missed events" — and nothing did.
 *
 * NO STREAM IS SIMULATED HERE. `sessionFetch` is stubbed so the stream request rejects, which is exactly
 * the case the seed exists for and the case a browser test cannot arrange.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFetch = vi.fn();

vi.mock('@/shared/api/session-fetch', () => ({
  sessionFetch: (...a: unknown[]) => sessionFetch(...a),
}));
let authed = true;
vi.mock('@/shared/api/auth-store', () => ({ isAuthenticated: () => authed }));
vi.mock('@/shared/config/env', () => ({ ENV: { API_BASE_URL: '' } }));

import { useSSENotifications } from './use-sse-notifications';

/** A stream request that never succeeds, and a count request that answers `count`. */
function withCount(count: number, streamOk = false) {
  sessionFetch.mockImplementation((url: string) => {
    if (url.includes('/unread-count')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count }) });
    }
    if (streamOk) return Promise.resolve({ ok: true, body: null });
    return Promise.reject(new Error('stream blocked'));
  });
}

describe('useSSENotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed = true;
  });

  it('seeds the badge from the API when the stream cannot be opened', async () => {
    withCount(4);
    const { result } = renderHook(() => useSSENotifications());

    // Without the seed this stays 0 forever and the bell claims there is nothing to read.
    await waitFor(() => expect(result.current.unreadCount).toBe(4));
  });

  it('asks for nothing before the session bootstrap has resolved', async () => {
    /*
     * Both requests are gated on `isAuthenticated()`. Seeding before the cookie is in place would 401 and,
     * for the stream, burn a back-off cycle for nothing.
     *
     * NOT TESTED, AND WORTH SAYING SO: the seed also declines to touch the badge when the count request
     * FAILS. That guard is correct but unobservable from here — the value it would overwrite is zero
     * already, so a mutation that resets to zero on failure passes every assertion. It is defensive against
     * a future caller seeding a non-zero badge, not something this suite can pin.
     */
    authed = false;
    withCount(7);
    renderHook(() => useSSENotifications());

    await new Promise((r) => setTimeout(r, 20));
    expect(sessionFetch).not.toHaveBeenCalled();
  });

  it('asks the endpoint the API told it to ask', async () => {
    withCount(1);
    renderHook(() => useSSENotifications());

    await waitFor(() =>
      expect(
        sessionFetch.mock.calls.some((c) =>
          String(c[0]).includes('/v1/notifications/unread-count'),
        ),
      ).toBe(true),
    );
  });

  it('still exposes the local adjustments the bell drives', async () => {
    withCount(3);
    const { result } = renderHook(() => useSSENotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(3));

    // Reading one decrements; marking all read clears. Both stay local — the bell already knows what it
    // did, and a refetch per click would be a request to learn what the click already established.
    result.current.decrementUnread();
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    result.current.resetUnread();
    await waitFor(() => expect(result.current.unreadCount).toBe(0));
  });
});
