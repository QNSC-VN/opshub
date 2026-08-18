// @vitest-environment jsdom
/**
 * The standing-privileged-access panel.
 *
 * WHAT ONLY A COMPONENT TEST REACHES. Three of these are about what the panel REFUSES to render, and a
 * browser test cannot tell "absent because correct" from "absent because broken":
 *
 *   - AN EMPTY OR FAILED READ RENDERS NOTHING. "You hold no privileged access" is the reassuring reading, and
 *     a failed request must not produce it. The panel is a finding, so its silence has to mean silence.
 *   - REVOKE IS WITHHELD WITHOUT `access_request.security_approve`, because the route is guarded by it while
 *     `grants/me/active` is `@SelfScoped` — the holder may read their own grant and may not end it.
 *   - THE COUNTDOWN IS MEASURED FROM WHEN THE SERVER ANSWERED, not from the render clock. Only a fake
 *     response with a known `dataUpdatedAt` can pin that.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();

vi.mock('@/shared/api/client', () => ({ api: { GET: (...a: unknown[]) => GET(...a) } }));

import { MyGrantsPanel } from './my-grants-panel';

/** A grant whose window closes `ms` from now. */
function grant(ms: number, over: Record<string, unknown> = {}) {
  return {
    id: 'g-1',
    requestId: 'r-1',
    granteeId: 'emp-1',
    accessType: 'pim_role',
    target: 'prod-sql-01',
    grantedAt: '2026-08-18T09:00:00.000Z',
    expiresAt: new Date(Date.now() + ms).toISOString(),
    revokedAt: null,
    ...over,
  };
}

function renderPanel(props: { canRevoke: boolean }, onRevoke = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MyGrantsPanel canRevoke={props.canRevoke} onRevoke={onRevoke} />
    </QueryClientProvider>,
  );
  return { ...view, onRevoke };
}

describe('MyGrantsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // OFF THE BOUNDARY on purpose. The label rounds DOWN — deliberately, so it never promises time that has
    // gone — so an exact `3 * 3_600_000` reads "2h left" once a few milliseconds of fetch have elapsed.
    GET.mockResolvedValue({ data: [grant(3.5 * 3_600_000)], error: undefined });
  });

  it('names the standing exposure and how long is left', async () => {
    renderPanel({ canRevoke: false });

    expect(await screen.findByText(/You hold 1 active privileged grant/)).toBeTruthy();
    expect(screen.getByText('prod-sql-01')).toBeTruthy();
    // Humanised from the enum, not printed raw: `pim_role` is not a thing anybody says.
    expect(screen.getByText('Pim role')).toBeTruthy();
    // The remaining budget, measured from when the server answered.
    expect(screen.getByText('3h left')).toBeTruthy();
  });

  it('renders nothing at all when the caller holds none', async () => {
    GET.mockResolvedValue({ data: [], error: undefined });
    const { container } = renderPanel({ canRevoke: false });

    // Not an empty state: the ABSENCE of standing privileged access is the ordinary case, and a permanent
    // panel saying so would be noise above the list the reader came for.
    await vi.waitFor(() => expect(GET).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the read FAILS, so silence never reads as an all-clear', async () => {
    GET.mockResolvedValue({ data: undefined, error: { error: { message: 'nope' } } });
    const { container } = renderPanel({ canRevoke: false });

    await vi.waitFor(() => expect(GET).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('withholds revoke without access_request.security_approve', async () => {
    renderPanel({ canRevoke: false });
    expect(await screen.findByText('prod-sql-01')).toBeTruthy();

    // The holder may READ their own grant (`@SelfScoped`) and may not END it — the route needs the
    // approver's permission. A button here would be a 403, and there is no "request revocation" endpoint
    // to offer instead.
    expect(screen.queryByRole('button', { name: /^Revoke/ })).toBeNull();
    expect(screen.getByText(/Each lapses on its own/)).toBeTruthy();
    expect(screen.queryByText(/Hand one back early/)).toBeNull();
  });

  it('hands the whole grant to the confirmation, not just its id', async () => {
    const { onRevoke } = renderPanel({ canRevoke: true });
    expect(await screen.findByText('prod-sql-01')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Pim role on prod-sql-01' }));
    // The page's dialog names the access and its expiry, so it needs the row, not an id it would have to
    // look up again.
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(onRevoke.mock.calls[0][0]).toMatchObject({ id: 'g-1', target: 'prod-sql-01' });
  });

  it('turns amber under the hour, because that is when it becomes a decision', async () => {
    GET.mockResolvedValue({ data: [grant(20.5 * 60_000)], error: undefined });
    renderPanel({ canRevoke: true });

    const badge = await screen.findByText('20m left');
    // `text-warning`, not `amber`: the TONE is named `amber` and the class it maps to is not, so asserting
    // the tone name would pass on a badge that rendered no colour at all.
    expect(badge.className).toContain('text-warning');
  });
});
