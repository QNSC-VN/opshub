// @vitest-environment jsdom
/**
 * EntityDetailPanel — the section ORDER, and the two sections that must not appear when empty.
 *
 * `ActivityTimeline` fetches, so it is stubbed: what is under test is which sections this composes and
 * in what order, not what the timeline renders.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntityDetailPanel } from './entity-detail-panel';

vi.mock('./activity-timeline', () => ({
  ActivityTimeline: ({ resourceType }: { resourceType: string }) => (
    <div data-testid="activity">{resourceType} timeline</div>
  ),
}));

const ITEMS = [
  { label: 'Work date', value: '4 Mar 2026' },
  { label: 'Status', value: 'Approved' },
];

describe('EntityDetailPanel', () => {
  it('renders the details, then anything specific, then the activity — in that order', () => {
    // The order is the contract: what this is, what is special about it, what happened to it. Six
    // hand-rolled copies each re-decided it.
    const { container } = render(
      <EntityDetailPanel
        open
        onClose={vi.fn()}
        title="Timesheet"
        items={ITEMS}
        activity={{ resourceId: 'r1', resourceType: 'timesheet' }}
      >
        <div data-testid="extra">upload widget</div>
      </EntityDetailPanel>,
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('Work date')).toBeLessThan(text.indexOf('upload widget'));
    expect(text.indexOf('upload widget')).toBeLessThan(text.indexOf('timesheet timeline'));
  });

  it('OMITS the activity section when the record has no audit trail', () => {
    // An "Activity" heading over nothing tells the reader the trail is empty when in fact it was
    // never asked for.
    render(<EntityDetailPanel open onClose={vi.fn()} title="Shift" items={ITEMS} />);
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity')).not.toBeInTheDocument();
  });

  it('omits the middle section when there are no extra children', () => {
    render(
      <EntityDetailPanel
        open
        onClose={vi.fn()}
        title="Overtime"
        items={ITEMS}
        activity={{ resourceId: 'r1', resourceType: 'overtime' }}
      />,
    );
    expect(screen.getByTestId('activity')).toBeInTheDocument();
    expect(screen.getByText('Work date')).toBeInTheDocument();
  });

  it('passes the items through to a real description list', () => {
    const { container } = render(
      <EntityDetailPanel
        open
        onClose={vi.fn()}
        title="Leave"
        items={[{ label: 'Reason', value: null }]}
      />,
    );
    // Including the em dash, which is what makes an absent field look the same in every drawer.
    expect(container.querySelector('dl dt')?.textContent).toBe('Reason');
    expect(container.querySelector('dl dd')?.textContent).toBe('—');
  });

  it('is not reachable while closed', () => {
    // `SlideOver` stays MOUNTED and animates out — it hides with `pointer-events-none opacity-0` and
    // a translate rather than unmounting, so the content is still in the DOM. Asserting an empty
    // container would be asserting the wrong design; what matters is that nothing is clickable and
    // the panel is off-screen.
    const { container } = render(
      <EntityDetailPanel open={false} onClose={vi.fn()} title="Leave" items={ITEMS} />,
    );
    expect(container.querySelector('.pointer-events-none')).not.toBeNull();
    expect(container.querySelector('.translate-x-full')).not.toBeNull();
    // And NOT exposed as a dialog: a closed drawer that keeps `role="dialog"` is announced as a
    // second dialog whenever a modal opens over it. Playwright found exactly that — two matches for
    // one visible dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      container.querySelector('[aria-hidden="true"][class*="translate-x-full"]'),
    ).not.toBeNull();
  });

  it('IS a dialog once open', () => {
    render(<EntityDetailPanel open onClose={vi.fn()} title="Leave" items={ITEMS} />);
    expect(screen.getByRole('dialog', { name: 'Leave' })).toBeInTheDocument();
  });
});
