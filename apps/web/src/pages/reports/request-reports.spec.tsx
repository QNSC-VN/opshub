// @vitest-environment jsdom
/**
 * The request-mix panel's data shaping.
 *
 * ASSERTED THROUGH THE TABLE, not the chart. `ResponsiveContainer` measures its parent, and in jsdom that
 * is zero — recharts then renders nothing, so a chart assertion here would pass or fail on layout rather
 * than on the numbers. The table is plain HTML carrying the same grid, which is also why it exists: the
 * stack folds two statuses together and one segment sits under 3:1 against the surface.
 *
 * THE FOLD IS THE INTERESTING PART. `cancelled` and `expired` share a colour in `statusTone` because they
 * mean the same thing operationally, and two adjacent segments of identical colour read as one bar with a
 * wrong total — so the chart folds them and the table must NOT.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const GET = vi.fn();
vi.mock('@/shared/api/client', () => ({ api: { GET: (...a: unknown[]) => GET(...a) } }));

import { RequestMixChart } from './request-reports';

function rows(...r: [string, string, number][]) {
  return {
    from: '2026-07-19',
    to: '2026-08-18',
    rows: r.map(([type, status, count]) => ({ type, status, count })),
  };
}

function renderChart() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RequestMixChart days={30} />
    </QueryClientProvider>,
  );
}

/** The cells of one table row, by its leading header. */
function rowCells(type: string): string[] {
  const th = screen.getByRole('rowheader', { name: type });
  const tr = th.closest('tr')!;
  return [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
}

describe('RequestMixChart', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps cancelled and expired separate in the table, where the chart folds them', async () => {
    GET.mockResolvedValue({
      data: rows(['access_request', 'cancelled', 2], ['access_request', 'expired', 3]),
      error: undefined,
    });
    renderChart();

    expect(await screen.findByRole('rowheader', { name: 'Access Request' })).toBeTruthy();
    // Two columns, two different numbers — the fold is a CHART concern only.
    expect(screen.getByRole('columnheader', { name: 'Cancelled' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Expired' })).toBeTruthy();
    expect(rowCells('Access Request')).toEqual(['2', '3', '5']);
  });

  it('totals a row across every status', async () => {
    GET.mockResolvedValue({
      data: rows(['leave', 'pending', 4], ['leave', 'approved', 6], ['leave', 'rejected', 1]),
      error: undefined,
    });
    renderChart();

    expect(await screen.findByRole('rowheader', { name: 'Leave' })).toBeTruthy();
    // Statuses are column-sorted alphabetically: approved, pending, rejected — then the total.
    expect(rowCells('Leave')).toEqual(['6', '4', '1', '11']);
  });

  it('puts the busiest type first, since that is the one being looked for', async () => {
    GET.mockResolvedValue({
      data: rows(['quiet_type', 'pending', 1], ['busy_type', 'pending', 9]),
      error: undefined,
    });
    renderChart();

    await screen.findByRole('rowheader', { name: 'Busy Type' });
    const headers = screen.getAllByRole('rowheader').map((h) => h.textContent);
    expect(headers).toEqual(['Busy Type', 'Quiet Type']);
  });

  it('says the window is empty rather than drawing an empty chart', async () => {
    GET.mockResolvedValue({ data: rows(), error: undefined });
    renderChart();
    expect(await screen.findByText('No requests in this window')).toBeTruthy();
  });

  it('names a failed read rather than showing zero requests', async () => {
    // An error must not look like "no requests" — the same distinction the grants panel turns on.
    GET.mockResolvedValue({ data: undefined, error: { error: { message: 'nope' } } });
    renderChart();
    expect(await screen.findByText('Failed to load data')).toBeTruthy();
  });
});
