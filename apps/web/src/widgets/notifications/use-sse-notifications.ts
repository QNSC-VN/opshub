/**
 * useSSENotifications — fetch-based Server-Sent Events hook.
 *
 * Why fetch and not native EventSource: the original reason was that EventSource cannot
 * send custom headers and the API needed `Authorization: Bearer <token>`. That reason is
 * gone — authentication is now an ambient cookie, which EventSource sends with
 * `withCredentials`. fetch + ReadableStream is kept for a different reason worth stating:
 * it gives an AbortController for deterministic teardown on unmount and full control of
 * the reconnect back-off, where EventSource reconnects on its own schedule and cannot be
 * cancelled as precisely.
 *
 * Reconnect strategy: exponential back-off (1 s → 2 s → 4 s … capped at 30 s).
 * On reconnect the `connected` event returns the current unread count so the
 * badge is always accurate even if events were missed while disconnected.
 *
 * THE COUNT IS SEEDED FROM THE API, NOT FROM ZERO. `connected` is authoritative once it arrives — but
 * until then, and for as long as the stream cannot be opened at all, the badge used to read zero and say
 * so confidently. A proxy that blocks `text/event-stream`, an offline moment, a 500 on the stream route:
 * every one of them left a user with unread notifications looking at a clean bell. That is the same
 * failure as an empty list standing in for a failed one, and the API's own SSE controller already says
 * what to do about it — "call GET /notifications/unread-count to reconcile missed events". Nothing did.
 */
import { useEffect, useRef, useState } from 'react';
import { ENV } from '@/shared/config/env';
import { isAuthenticated } from '@/shared/api/auth-store';
import { sessionFetch } from '@/shared/api/session-fetch';

export interface SSENotificationPayload {
  notificationId: string;
  type: string;
  title: string;
  body?: string;
  resourceId?: string;
}

interface UseSSENotificationsResult {
  unreadCount: number;
  /** Called by the bell component when the user marks all as read. */
  resetUnread: () => void;
  /** Called when a single notification is read. */
  decrementUnread: () => void;
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

/**
 * Parse SSE chunks into events.  A single fetch chunk may contain multiple
 * events separated by "\n\n", or a partial event that continues in the next
 * chunk.
 */
function* parseSSEChunks(buffer: string): Generator<{ event: string; data: string }> {
  const events = buffer.split('\n\n');
  for (const block of events) {
    if (!block.trim()) continue;
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
      else if (line.startsWith(': ')) {
        // heartbeat comment — ignore
      }
    }
    if (data) yield { event, data };
  }
}

export function useSSENotifications(): UseSSENotificationsResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const mountedRef = useRef(true);
  /** Set once the stream has reported a count, so a slow seed cannot overwrite the authoritative one. */
  const streamAnsweredRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    /**
     * The count as the SERVER has it, read once before the stream is up.
     *
     * Deliberately not a `useQuery`: this hook is the notification badge's only source of truth and owns
     * `unreadCount` in local state, so a second cache holding the same number is a second thing that can
     * disagree. The `connected` event overwrites this the moment it arrives.
     */
    async function seedCount() {
      if (!isAuthenticated()) return;
      try {
        const res = await sessionFetch(`${ENV.API_BASE_URL}/v1/notifications/unread-count`);
        if (!res.ok) return;
        const body = (await res.json()) as { count?: number };
        // Only if the stream has not already answered — `connected` is the authoritative number and this
        // request may land after it on a fast connection.
        if (mountedRef.current && !streamAnsweredRef.current && typeof body.count === 'number') {
          setUnreadCount(body.count);
        }
      } catch {
        // A failed count leaves the badge as it was. It must not reset to zero: that is the very claim
        // this seed exists to stop the UI making.
      }
    }

    async function connect() {
      // The session cookie travels automatically, so there is no token to check — but
      // opening a stream before the bootstrap has resolved would just 401 and burn a
      // back-off cycle.
      if (!isAuthenticated()) return;

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await sessionFetch(`${ENV.API_BASE_URL}/v1/notifications/stream`, {
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

        // Reset backoff on successful connection
        backoffRef.current = INITIAL_BACKOFF_MS;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (mountedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete events (terminated by double newline)
          const lastDouble = buffer.lastIndexOf('\n\n');
          if (lastDouble === -1) continue;

          const toProcess = buffer.slice(0, lastDouble + 2);
          buffer = buffer.slice(lastDouble + 2);

          for (const { event, data } of parseSSEChunks(toProcess)) {
            if (!mountedRef.current) break;
            try {
              const payload = JSON.parse(data) as Record<string, unknown>;
              if (event === 'connected') {
                streamAnsweredRef.current = true;
                setUnreadCount((payload['unreadCount'] as number) ?? 0);
              } else if (event === 'notification') {
                setUnreadCount((c) => c + 1);
              }
            } catch {
              // malformed JSON — ignore
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // intentional disconnect
        // Network error or server closed — schedule reconnect
      }

      if (!mountedRef.current) return;

      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      retryRef.current = setTimeout(connect, delay);
    }

    void seedCount();
    connect();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, []);

  return {
    unreadCount,
    resetUnread: () => setUnreadCount(0),
    decrementUnread: () => setUnreadCount((c) => Math.max(0, c - 1)),
  };
}
