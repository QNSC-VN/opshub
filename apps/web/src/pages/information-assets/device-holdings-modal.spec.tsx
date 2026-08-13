// @vitest-environment jsdom
/**
 * The lost-laptop report.
 *
 * WHY A COMPONENT TEST AND NOT ONLY A BROWSER ONE. Two of the three things worth pinning here are about
 * what the component REFUSES to do with the API's answer, and both need a response the seeded database
 * cannot produce on demand:
 *
 *   - AN EMPTY LIST IS NOT AN ALL-CLEAR. The API answers a device it has never heard of with the same empty
 *     list as a device that genuinely holds nothing registered — deliberately, so the two stay
 *     distinguishable from a 404 by the caller. A panel that rendered "no findings" would turn the honest
 *     ambiguity into a false reassurance during an incident.
 *   - THE RANKING IS THE DATABASE'S. "Worst first" comes from `isms.classification_levels.rank`, so the
 *     fixture below deliberately ranks `internal` ABOVE `restricted` — a nonsense ordering no seed would
 *     produce, and the only way to prove the component reads the API's order instead of re-deriving one
 *     from the label. Re-ranking locally is the bug this catches, and it would look correct forever in the
 *     browser suite.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();

vi.mock('@/shared/api/client', () => ({
  api: { GET: (...a: unknown[]) => GET(...a) },
}));

import { DeviceHoldingsModal } from './device-holdings-modal';

function renderModal(deviceAssetId: string, deviceLabel?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeviceHoldingsModal
        deviceAssetId={deviceAssetId}
        deviceLabel={deviceLabel}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

function holding(over: Partial<Record<string, unknown>> = {}) {
  return {
    informationAssetId: 'ia-1',
    reference: 'IA-2026-001',
    name: 'Customer billing extract',
    classification: 'restricted',
    classificationRank: 40,
    personalData: true,
    ownerId: 'emp-1',
    ...over,
  };
}

/** Route by path, so a test never has to care which query fired first. */
function respond(byPath: Record<string, unknown>) {
  GET.mockImplementation((path: string) => {
    const match = Object.keys(byPath).find((key) => path.includes(key));
    return Promise.resolve({ data: match ? byPath[match] : undefined, error: undefined });
  });
}

describe('DeviceHoldingsModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an empty result as the limit of the register, not as a clean device', async () => {
    respond({ 'device-holdings': [] });
    renderModal('dev-1', 'LT-0042');

    expect(await screen.findByText(/Nothing in the register is recorded/)).toBeTruthy();
    // The distinction the API's own contract turns on. Without this sentence the same empty list reads as
    // "we checked and it was empty", which is the one conclusion it does not support.
    expect(screen.getByText(/not the same as the device being empty/)).toBeTruthy();
  });

  it('takes "worst" from the API ordering rather than re-ranking the labels here', async () => {
    // The database says `internal` outranks `restricted`. Nonsense as policy, and exactly the point: a
    // component that sorted by its own idea of the labels would answer "Restricted".
    respond({
      'device-holdings': [
        holding({ classification: 'internal', classificationRank: 90, personalData: false }),
        holding({
          informationAssetId: 'ia-2',
          classification: 'restricted',
          classificationRank: 2,
        }),
      ],
    });
    renderModal('dev-1', 'LT-0042');

    const triage = await screen.findByText(/2 registered assets/);
    expect(triage.textContent).toContain('Internal');
    expect(triage.textContent).not.toContain('Restricted');
    // Personal data is counted, not inferred from the count of rows: it is what decides whether a lost
    // device is a breach assessment rather than an inventory correction.
    expect(triage.textContent).toContain('1 hold personal data');
  });

  it('asks for a device before reporting on one, and fetches nothing until it has one', async () => {
    respond({ 'device-holdings': [holding()] });
    renderModal('');

    expect(
      await screen.findByText(/Choose a device to see the registered information/),
    ).toBeTruthy();
    // No device, no report. The picker's own search is `enabled` only while its list is open, so a cold
    // open must issue no requests at all.
    await waitFor(() => expect(GET).not.toHaveBeenCalled());
  });
});
