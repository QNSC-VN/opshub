// @vitest-environment jsdom
/**
 * Tabs — the ARIA wiring and the keyboard, which is the whole reason this replaced two hand-rolled
 * bars that had neither.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './tabs';

const ITEMS = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
] as const;

function setup(value: 'one' | 'two' | 'three' = 'one') {
  const onChange = vi.fn();
  render(<Tabs items={[...ITEMS]} value={value} onChange={onChange} idPrefix="t" />);
  return { onChange };
}

describe('Tabs', () => {
  it('is a tablist of tabs, with the selected one marked', () => {
    setup('two');
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('points each tab at the panel it controls, and the panel back at the tab', () => {
    // The half nobody hand-rolls: without it a screen reader cannot tell that the content below
    // belongs to the selected tab.
    render(
      <>
        <Tabs items={[...ITEMS]} value="one" onChange={vi.fn()} idPrefix="t" />
        <TabPanel idPrefix="t" value="one">
          panel body
        </TabPanel>
      </>,
    );
    const tab = screen.getAllByRole('tab')[0];
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('keeps ONE tab stop — the selected tab — so Tab moves into the panel', () => {
    setup('two');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys and WRAPS at both ends', () => {
    const { onChange } = setup('one');
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('two');

    // Left from the first wraps to the last: a tab list is a loop, and stopping makes the last tab
    // feel broken.
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('three');
  });

  it('jumps to the ends with Home and End', () => {
    const { onChange } = setup('two');
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('one');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('three');
  });

  it('ignores keys that are not navigation', () => {
    const { onChange } = setup();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects on click', () => {
    const { onChange } = setup();
    screen.getByRole('tab', { name: 'Three' }).click();
    expect(onChange).toHaveBeenCalledWith('three');
  });

  it('renders a badge beside a label when given one', () => {
    render(
      <Tabs
        items={[{ value: 'a', label: 'Shadow IT', badge: <span>Upgrade</span> }]}
        value="a"
        onChange={vi.fn()}
        idPrefix="t"
      />,
    );
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
  });
});
