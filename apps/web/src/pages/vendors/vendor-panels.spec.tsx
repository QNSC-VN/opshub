// @vitest-environment jsdom
/**
 * The risks a supplier carries — the writing side.
 *
 * WHAT ONLY A COMPONENT TEST REACHES. Two of these are about affordances that must be ABSENT, which a
 * browser test is worst at proving (`toHaveCount(0)` passes just as happily when the panel never rendered),
 * and one is about fields the FE had been throwing away.
 *
 * THE ASYMMETRY IS THE INTERESTING ONE. `VendorService.linkRisk` calls `assertNotTerminated`; `unlinkRisk`
 * does not. So a terminated supplier takes no new risk but will still give one up, and this panel has to
 * reproduce that split exactly — offering a link that can only 412, or withdrawing an unlink the API would
 * have honoured, are both wrong and neither shows up as an error anywhere.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();
const PUT = vi.fn();
const DELETE = vi.fn();

vi.mock('@/shared/api/client', () => ({
  api: {
    GET: (...a: unknown[]) => GET(...a),
    PUT: (...a: unknown[]) => PUT(...a),
    DELETE: (...a: unknown[]) => DELETE(...a),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { VendorRisksPanel } from './vendor-panels';

const LINKED = {
  id: 'risk-1',
  reference: 'RSK-0042',
  title: 'Supplier concentration',
  description: 'Only one provider can deliver this service.',
  category: 'third-party',
  assetId: null,
  ownerId: 'emp-1',
  inherentLikelihood: 4,
  inherentImpact: 5,
  inherentScore: 20,
  residualLikelihood: null,
  residualImpact: null,
  residualScore: null,
  status: 'assessed',
  reviewDueOn: null,
  createdAt: '2026-08-01T09:00:00.000Z',
};

function renderPanel(props: { canManage: boolean; terminated: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VendorRisksPanel vendorId="v-1" criticality="critical" {...props} />
    </QueryClientProvider>,
  );
}

describe('VendorRisksPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    GET.mockImplementation((path: string) =>
      Promise.resolve({
        // The picker's own search and the panel's linked list are different endpoints.
        data:
          path === '/v1/risks'
            ? { data: [{ id: 'risk-2', reference: 'RSK-0099', title: 'Single point of failure' }] }
            : [LINKED],
        error: undefined,
      }),
    );
    PUT.mockResolvedValue({ error: undefined });
    DELETE.mockResolvedValue({ error: undefined });
  });

  it('links a risk by the pair of ids, with no body', async () => {
    renderPanel({ canManage: true, terminated: false });
    expect(await screen.findByText('RSK-0042')).toBeTruthy();

    const picker = screen.getByRole('combobox', { name: 'Risk to link' });
    fireEvent.focus(picker);
    // The BUTTON inside the option, and `onMouseDown`: the handler is on the button (React events bubble
    // up, so firing on the `<li role="option">` never reaches it) and the picker's click-outside listener
    // closes the list before a click would land.
    await screen.findByRole('option', { name: /RSK-0099/ });
    fireEvent.mouseDown(screen.getByRole('button', { name: /RSK-0099/ }));

    await waitFor(() => expect(PUT).toHaveBeenCalledTimes(1));
    expect(PUT.mock.calls[0][0]).toBe('/v1/vendors/{id}/risks/{riskId}');
    // THE PAIR IS THE WHOLE FACT, which is what makes the route idempotent.
    expect(PUT.mock.calls[0][1]).toEqual({ params: { path: { id: 'v-1', riskId: 'risk-2' } } });
  });

  it('shows the status and score the API sends, which the old type hid', async () => {
    renderPanel({ canManage: false, terminated: false });
    expect(await screen.findByText('RSK-0042')).toBeTruthy();

    /*
     * `/v1/vendors/{id}/risks` returns the risk register's own dto in full. The FE alias pointed at
     * `LinkedRiskResponseDto` — the CONTROLS route's three-field schema — which was assignable, so nothing
     * complained and both of these were simply unavailable. A closed risk standing in as a critical
     * supplier's only linked risk satisfies the gap report while meaning nothing, so the status is shown.
     */
    expect(screen.getByText('Assessed')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('withdraws the picker once terminated, but keeps the unlink the API still honours', async () => {
    renderPanel({ canManage: true, terminated: true });
    expect(await screen.findByText('RSK-0042')).toBeTruthy();

    // No new link: `linkRisk` asserts the supplier is not terminated, so the control could only 412.
    expect(screen.queryByRole('combobox', { name: 'Risk to link' })).toBeNull();
    expect(screen.getByText(/no further risk can be linked/)).toBeTruthy();

    // Unlink STAYS. `unlinkRisk` carries no such assertion: what the supplier put at risk is a record of
    // the engagement, and correcting a link that was always wrong is a different act.
    fireEvent.click(screen.getByRole('button', { name: 'Unlink RSK-0042' }));
    await waitFor(() => expect(DELETE).toHaveBeenCalledTimes(1));
    expect(DELETE.mock.calls[0][1]).toEqual({
      params: { path: { id: 'v-1', riskId: 'risk-1' } },
    });
  });

  it('offers no writes without vendor.manage', async () => {
    renderPanel({ canManage: false, terminated: false });
    expect(await screen.findByText('RSK-0042')).toBeTruthy();

    expect(screen.queryByRole('button', { name: 'Unlink RSK-0042' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Risk to link' })).toBeNull();
  });
});
