// @vitest-environment jsdom
/**
 * The devices an information asset is held on — the writing side.
 *
 * WHAT ONLY A COMPONENT TEST CAN PIN. All three cases below are about which affordances are ABSENT, and an
 * absent control is what a browser test is worst at proving: `toHaveCount(0)` passes just as happily when
 * the panel failed to render at all.
 *
 * THE ASYMMETRY IS THE INTERESTING ONE. `InformationAssetService.linkDevice` asserts the asset is not
 * retired; `unlinkDevice` does not. So a retired asset takes no NEW device but will still give one up, and
 * this panel has to reproduce that split exactly — offering a link that can only 412, or withdrawing an
 * unlink the API would have honoured, are both wrong and neither shows up as an error anywhere.
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

import { AssetDevicesPanel } from './asset-panels';

const DEVICE = {
  deviceAssetId: 'dev-1',
  assetTag: 'LT-0042',
  type: 'laptop',
  status: 'assigned',
  assignedTo: 'emp-1',
};

function renderPanel(props: { canManage: boolean; retired: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AssetDevicesPanel
        assetId="ia-1"
        encryptionRequired={false}
        onInspectDevice={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('AssetDevicesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    GET.mockImplementation((path: string) =>
      Promise.resolve({
        // The picker's own search and the panel's device list are different endpoints.
        data: path.includes('/v1/assets')
          ? { data: [{ id: 'dev-2', assetTag: 'LT-0099', type: 'laptop', manufacturer: 'Dell' }] }
          : [DEVICE],
        error: undefined,
      }),
    );
    PUT.mockResolvedValue({ error: undefined });
    DELETE.mockResolvedValue({ error: undefined });
  });

  it('links a device by the pair of ids, with no body', async () => {
    renderPanel({ canManage: true, retired: false });
    expect(await screen.findByText('LT-0042')).toBeTruthy();

    const picker = screen.getByRole('combobox', { name: 'Device to link' });
    fireEvent.focus(picker);
    // The BUTTON inside the option, and `onMouseDown` rather than click: the handler is on the button
    // (React events bubble up, so firing on the `<li role="option">` never reaches it), and the picker's own
    // click-outside listener closes the list before a click would land.
    await screen.findByRole('option', { name: /LT-0099/ });
    fireEvent.mouseDown(screen.getByRole('button', { name: /LT-0099/ }));

    await waitFor(() => expect(PUT).toHaveBeenCalledTimes(1));
    expect(PUT.mock.calls[0][0]).toBe('/v1/information-assets/{id}/devices/{deviceAssetId}');
    // THE PAIR IS THE WHOLE FACT, which is what makes the route idempotent. A body here would mean the
    // link carried state the natural key does not.
    expect(PUT.mock.calls[0][1]).toEqual({
      params: { path: { id: 'ia-1', deviceAssetId: 'dev-2' } },
    });
  });

  it('withdraws the link picker once retired, but keeps the unlink the API still honours', async () => {
    renderPanel({ canManage: true, retired: true });
    expect(await screen.findByText('LT-0042')).toBeTruthy();

    // No new link: `linkDevice` asserts the asset is not retired, so the control could only produce a 412.
    expect(screen.queryByRole('combobox', { name: 'Device to link' })).toBeNull();
    expect(screen.getByText(/no new device can be recorded/)).toBeTruthy();

    // Unlink STAYS. `unlinkDevice` carries no such assertion: retirement freezes what the asset held as
    // evidence, and correcting a link that was always wrong is a different act.
    fireEvent.click(screen.getByRole('button', { name: 'Unlink LT-0042' }));
    await waitFor(() => expect(DELETE).toHaveBeenCalledTimes(1));
    expect(DELETE.mock.calls[0][1]).toEqual({
      params: { path: { id: 'ia-1', deviceAssetId: 'dev-1' } },
    });
  });

  it('leaves the report reachable without manage, and offers no writes', async () => {
    renderPanel({ canManage: false, retired: false });
    expect(await screen.findByText('LT-0042')).toBeTruthy();

    // Reading what else is on a device is a REPORT — the person asking during an incident is often not the
    // one who maintains the register.
    expect(screen.getByRole('button', { name: 'What LT-0042 holds' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlink LT-0042' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Device to link' })).toBeNull();
  });
});
