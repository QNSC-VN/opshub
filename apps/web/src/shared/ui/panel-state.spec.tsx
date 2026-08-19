// @vitest-environment jsdom
/**
 * The ordering of the three branches, which is the whole reason this component exists.
 *
 * Four hand-rolled panels tested emptiness as `!isLoading && count === 0` with no error branch. That
 * predicate is ALSO true when the request failed — `data` is undefined, so the count is zero — so a
 * failed load did not render a blank panel. It asserted an absence: "No risks linked", "No reviews in
 * this cycle yet", and worst of all "Everybody in scope has a completed review" in green, which is a
 * compliance all-clear produced by a broken fetch.
 *
 * So the tests that matter here are not "does it render a message". They are: does a FAILED query with
 * a zero count report the failure rather than the emptiness, and can a caller reach the empty state
 * without having settled successfully.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelState } from './panel-state';

const LOADING = { isLoading: true, isError: false };
const FAILED = { isLoading: false, isError: true };
const SETTLED = { isLoading: false, isError: false };

describe('PanelState', () => {
  it('reports a failure rather than an emptiness when both look true', () => {
    /*
     * THE DEFECT, as a test. A failed query has no data, so `count` is 0 — the exact state in which the
     * hand-rolled version showed its empty message. `isError` must win.
     */
    render(
      <PanelState
        query={FAILED}
        count={0}
        empty="Everybody in scope has a completed review"
        error="Failed to load the coverage report."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load the coverage report.');
    expect(
      screen.queryByText('Everybody in scope has a completed review'),
      'a failed load claimed the panel was empty',
    ).toBeNull();
  });

  it('says nothing about emptiness while the query is still loading', () => {
    // The other half of the same ordering problem: `count` is 0 before the first response too.
    render(<PanelState query={LOADING} count={0} empty="No treatment actions" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText('No treatment actions')).toBeNull();
  });

  it('shows the empty message only once the query has settled successfully', () => {
    render(<PanelState query={SETTLED} count={0} empty="No treatment actions" />);
    expect(screen.getByText('No treatment actions')).toBeInTheDocument();
    // Not an alert: an empty panel is not a failure, and announcing it as one trains people to ignore
    // the role that does mean failure.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing when there is data, so the caller draws its own list', () => {
    const { container } = render(
      <PanelState query={SETTLED} count={3} empty="No treatment actions" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('announces a failure and merely states a loading', () => {
    /*
     * Different roles on purpose. Loading is `status` (polite — it must not interrupt a reader looking
     * at something else on the page); a failure is `alert` (assertive — the content is not coming, and
     * finding that out by noticing an absence is not finding out).
     */
    const { unmount } = render(<PanelState query={LOADING} count={0} empty="x" />);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();

    render(<PanelState query={FAILED} count={0} empty="x" error="It broke." />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('It broke.');
  });

  it('still says something when the caller supplies no error message', () => {
    // A caller that forgets the message must not get a silent blank — that is the state this component
    // was built to remove, and it would be perverse to reintroduce it as a default.
    render(<PanelState query={FAILED} count={0} empty="No rows" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load.');
  });

  it('tones the empty state as a success where empty is the good outcome', () => {
    const { container } = render(
      <PanelState query={SETTLED} count={0} empty="Everybody is covered" emptyTone="success" />,
    );
    // `text-success`, not a raw green: the token flips in dark mode and a literal would not.
    expect(container.querySelector('p')?.className).toContain('text-success');
  });
});
