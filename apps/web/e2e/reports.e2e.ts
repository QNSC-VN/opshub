import { test } from '@playwright/test';
import { expect, gotoInShell } from './support/fixtures';

/**
 * The reports dashboard.
 *
 * WHY A BROWSER SPEC AT ALL, when the panel's numbers are covered by a component test: recharts measures
 * its parent to decide whether to draw anything, and in jsdom that measurement is zero — so the component
 * test asserts the table and says nothing about whether a chart appears. This is the only place that can
 * tell "the panel rendered" from "the panel rendered an empty box", which is exactly the failure mode of a
 * responsive chart.
 */
test.describe('reports', () => {
  test('draws every panel, with the request mix legible as a chart and a table', async ({
    page,
  }) => {
    await gotoInShell(page, '/reports');

    // Every panel by name, so a broken import shows up as a missing section rather than a blank column.
    for (const title of [
      'Request Throughput',
      'Live Queue Depth',
      'SLA Compliance',
      'Cycle Time (p50 / p90)',
      'Requests by Type and Status',
      'Asset Utilization',
      'Open Compliance Findings',
      'Workforce Summary',
    ]) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 });
    }

    /*
     * A RENDERED CHART, not an empty responsive box. `ResponsiveContainer` silently draws nothing when its
     * parent measures zero, which is indistinguishable from a working chart to any test that only checks the
     * panel exists.
     *
     * ADDRESSED BY ACCESSIBLE NAME rather than by walking the DOM: scoping with
     * `locator('div').filter({ hasText })` picked the heading's own container, so the chart was never inside
     * the element being searched — the first draft failed against a chart that was rendering perfectly well.
     *
     * `Cancelled / expired` is a LEGEND label unique to this panel, and recharts emits the legend only when
     * it has drawn the chart — so its presence is the signal that the chart is really there.
     */
    await expect(page.getByText('Cancelled / expired')).toBeVisible({ timeout: 20_000 });

    // The table view, by the caption it carries for exactly this purpose. It is where the two statuses the
    // chart folds together stay separable.
    const table = page.getByRole('table', { name: 'Request counts by type and status' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Total' })).toBeVisible();

    /*
     * NO PANEL IS SHOWING AN ERROR, and this is the assertion the screen most needed.
     *
     * Seven of the nine requests this page makes were answering 422 — `dateRange()` sent `YYYY-MM-DD`
     * where every report parameter is `z.string().datetime({ offset: true })` — so throughput, SLA, cycle
     * time, findings, leave and overtime all rendered "Failed to load data". Nothing caught it: the only
     * coverage was `shell.e2e.ts` asserting `/reports` renders without an error BOUNDARY, and six panels
     * each displaying an error message satisfies that perfectly.
     */
    await expect(page.getByText('Failed to load data')).toHaveCount(0);
  });
});
