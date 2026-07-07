/**
 * useSSENotifications — fetch-based Server-Sent Events hook.
 *
 * Why fetch instead of native EventSource:
 *   EventSource does not support custom headers.  Our API requires
 *   `Authorization: Bearer <token>`.  The fetch + ReadableStream approach
 *   gives us full header control while behaving identically to SSE.
 *
 * Reconnect strategy: exponential back-off (1 s → 2 s → 4 s … capped at 30 s).
 * On reconnect the `connected` event returns the current unread count so the
 * badge is always accurate even if events were missed while disconnected.
 */
import { useEffect, useRef, useState } from 'react';
import { ENV } from '@/shared/config/env';
import { getToken } from '@/shared/api/auth-store';

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

  useEffect(() => {
    mountedRef.current = true;

    async function connect() {
      const token = getToken();
      if (!token) return; // not yet authenticated

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`${ENV.API_BASE_URL}/v1/notifications/stream`, {
          headers: { Authorization: `Bearer ${token}` },
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
