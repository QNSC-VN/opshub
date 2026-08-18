// @vitest-environment jsdom
/**
 * Retrying a webhook delivery.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN. `POST /v1/webhooks/deliveries/{id}/retry` sets ANY delivery back to
 * `pending` with a fresh `nextAttemptAt` and checks no status whatsoever — so a click on a row that already
 * DELIVERED would re-send that event to the customer's endpoint. The route's own summary says "failed
 * webhook delivery"; the service does not enforce it, so the screen does, and this is where that rule lives.
 *
 * A browser test cannot show it: the seeded database has no failed delivery to click, and arranging one
 * means making a real endpoint refuse a real webhook.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();
const POST = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/shared/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => GET(...a),
    POST: (...a: unknown[]) => POST(...a),
    DELETE: vi.fn(),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

import { WebhooksPage } from './webhooks-page';

/** The real shape, from the generated schema — `events`, and no `secret` in any response. */
const SUB = {
  id: 'sub-1',
  url: 'https://example.test/hook',
  events: ['request.approved'],
  description: null,
  active: true,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

function delivery(over: Record<string, unknown> = {}) {
  return {
    id: 'del-1',
    subscriptionId: 'sub-1',
    eventType: 'request.approved',
    payload: {},
    status: 'failed',
    attempts: 3,
    deliveredAt: null,
    nextAttemptAt: '2026-08-18T12:00:00.000Z',
    lastError: 'connect ECONNREFUSED',
    createdAt: '2026-08-18T11:00:00.000Z',
    ...over,
  };
}

function renderPage(deliveries: unknown[]) {
  GET.mockImplementation((path: string) =>
    Promise.resolve({
      // Both routes answer with a bare ARRAY — no paged envelope on this screen.
      data: path.includes('/deliveries') ? deliveries : [SUB],
      error: undefined,
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  return {
    invalidate,
    ...render(
      <QueryClientProvider client={client}>
        <WebhooksPage />
      </QueryClientProvider>,
    ),
  };
}

/**
 * Open the drawer AND wait for the deliveries table to have loaded.
 *
 * WAITING FOR THE ROW IS THE POINT. The heading renders before the deliveries query resolves, so a
 * synchronous lookup straight after it finds nothing — and the two assertions below that Retry is ABSENT
 * then passed for the wrong reason, against an empty table. Measured: they passed while the button was in
 * fact rendering for a failed delivery.
 */
async function openDrawer(row: { eventType: string }) {
  fireEvent.click(await screen.findByText('https://example.test/hook'));
  expect(await screen.findByRole('heading', { name: 'Recent deliveries' })).toBeTruthy();
  // The row itself, so an absence assertion is about the button and not about an unloaded table. More than
  // one match because the event type also appears on the subscription row behind the drawer.
  await waitFor(() => expect(screen.getAllByText(row.eventType).length).toBeGreaterThan(1));
}

describe('WebhooksPage deliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    POST.mockResolvedValue({ error: undefined });
  });

  it('retries a failed delivery by id', async () => {
    const { invalidate } = renderPage([delivery()]);
    await openDrawer(delivery());

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    expect(POST.mock.calls[0][0]).toBe('/v1/webhooks/deliveries/{id}/retry');
    expect(POST.mock.calls[0][1]).toEqual({ params: { path: { id: 'del-1' } } });
    // QUEUED, not sent. The worker picks it up on its next pass, so claiming "retried" would assert an
    // outcome nobody has yet.
    expect(toastSuccess).toHaveBeenCalledWith('Retry queued');

    /*
     * AND THE TABLE IS REFRESHED. The retry moves the row back to `pending` server-side, so without this the
     * screen keeps showing `failed` with a Retry button that has already been used — and a second click
     * re-queues an event that is already queued. Caught by mutation: dropping the invalidation passed every
     * other assertion here.
     */
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['webhooks'] }));
  });

  it('offers no retry on a delivery that already succeeded', async () => {
    renderPage([
      delivery({ status: 'delivered', deliveredAt: '2026-08-18T11:05:00.000Z', lastError: null }),
    ]);
    await openDrawer(delivery());

    // The API would happily re-send it — that is exactly why the button is not there.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers no retry on one still pending, which the worker has not finished with', async () => {
    renderPage([delivery({ status: 'pending', attempts: 1, lastError: null })]);
    await openDrawer(delivery());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('passes the API refusal through instead of inventing one', async () => {
    POST.mockResolvedValue({ error: { error: { message: 'Webhook delivery not found' } } });
    renderPage([delivery()]);
    await openDrawer(delivery());

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Webhook delivery not found'));
  });
});
