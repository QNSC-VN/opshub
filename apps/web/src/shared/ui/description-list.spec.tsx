// @vitest-environment jsdom
/**
 * DescriptionList — a real `dl`, and the em dash that twelve copies each spelled for themselves.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DescriptionList } from './description-list';

describe('DescriptionList', () => {
  it('renders label/value PAIRS a screen reader can associate', () => {
    const { container } = render(
      <DescriptionList items={[{ label: 'Software', value: 'Nginx' }]} />,
    );
    // `dt`/`dd` inside a `dl`, not divs: that is what makes "Software, Nginx" one pair rather than
    // two unrelated lines.
    expect(container.querySelector('dl dt')?.textContent).toBe('Software');
    expect(container.querySelector('dl dd')?.textContent).toBe('Nginx');
  });

  it('renders the em dash for every flavour of absent, so no caller writes `?? "—"`', () => {
    render(
      <DescriptionList
        items={[
          { label: 'Null', value: null },
          { label: 'Undefined', value: undefined },
          { label: 'Empty', value: '' },
        ]}
      />,
    );
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it('keeps a legitimate zero, which `value || "—"` would have eaten', () => {
    render(<DescriptionList items={[{ label: 'Days', value: 0 }]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('spans a wide item across both columns', () => {
    const { container } = render(
      <DescriptionList
        items={[
          { label: 'Note', value: 'A long one', wide: true },
          { label: 'Short', value: 'x' },
        ]}
      />,
    );
    const cells = container.querySelectorAll('dl > div');
    expect(cells[0].className).toContain('col-span-full');
    expect(cells[1].className).not.toContain('col-span-full');
  });
});
