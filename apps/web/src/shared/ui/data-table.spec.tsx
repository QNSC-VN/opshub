// @vitest-environment jsdom
/**
 * DataTable — the four states, and the `colSpan` nobody was maintaining.
 *
 * These are the SPA's first component tests. They exist because the states are exactly what the
 * nine hand-rolled copies got wrong in different ways: one showed "no rows" on a failed request,
 * several had no empty state at all, and every one hard-coded `colSpan` so adding a column left the
 * loading row spanning the wrong width.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  count: number;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'count', header: 'Count', cell: (r) => r.count, align: 'right' },
  { key: 'extra', header: 'Extra', cell: () => '—', hideOnMobile: true },
];

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', count: 1 },
  { id: 'b', name: 'Beta', count: 2 },
];

describe('DataTable', () => {
  it('renders a header per column and a cell per row', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);

    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // Two data rows plus the header row.
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows loading and NOTHING else', () => {
    render(<DataTable columns={COLUMNS} rows={undefined} isLoading />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });

  it('shows the ERROR, not the empty state, when the request failed', () => {
    // The distinction the hand-rolled copies got wrong: a failed request has no rows either, and
    // "nothing here yet" is a lie about a list nobody managed to read.
    render(
      <DataTable columns={COLUMNS} rows={[]} isError errorMessage="Failed to load positions." />,
    );

    expect(screen.getByText('Failed to load positions.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });

  it('shows the empty state with its action only when the list is genuinely empty', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={[]}
        emptyMessage="No positions yet"
        emptyAction={<button type="button">Create one</button>}
      />,
    );

    expect(screen.getByText('No positions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create one' })).toBeInTheDocument();
  });

  it('spans every state row across ALL columns, derived rather than hard-coded', () => {
    const { container } = render(<DataTable columns={COLUMNS} rows={undefined} isLoading />);
    expect(container.querySelector('tbody td')?.getAttribute('colspan')).toBe('3');

    // The regression that matters: a fourth column must widen the state row with no other edit.
    cleanupAndRender(
      <DataTable
        columns={[...COLUMNS, { key: 'four', header: 'Four', cell: () => null }]}
        rows={undefined}
        isLoading
      />,
    );
    expect(document.querySelector('tbody td')?.getAttribute('colspan')).toBe('4');
  });

  it('makes rows clickable when onRowClick is given', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />);

    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('tabindex', '0');

    rows[0].click();
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it('activates a row from the KEYBOARD, on Enter and on Space', () => {
    // A clickable row that only answers a mouse is unusable for anybody who does not use one, and
    // this is the assertion that makes the claim true rather than aspirational — the handler was
    // the one uncovered branch in this file.
    const onRowClick = vi.fn();
    render(<DataTable columns={COLUMNS} rows={ROWS} onRowClick={onRowClick} />);
    const row = screen.getAllByRole('button')[1];

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);

    // Space too: a browser scrolls the page on Space, so the handler must both act and preventDefault.
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(2);

    // …and ONLY those two. Tab must still move focus rather than open the row.
    fireEvent.keyDown(row, { key: 'Tab' });
    fireEvent.keyDown(row, { key: 'a' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it('marks the active row so an open detail panel has a visible anchor', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} isRowActive={(r) => r.id === 'b'} />);
    const rows = screen.getAllByRole('row');
    // Row 0 is the header; the active class lands on the second data row.
    expect(rows[2].className).toContain('bg-accent-muted');
    expect(rows[1].className).not.toContain('bg-accent-muted');
  });

  it('leaves rows inert — no role, no tab stop — when there is nothing to click', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keys rows by a custom function when the row has no id', () => {
    // Proves the fallback is a DEFAULT and not the only option: several API rows are keyed on a
    // composite (a code, an employee + a year) rather than an `id`.
    interface Keyless {
      code: string;
    }
    const columns: DataTableColumn<Keyless>[] = [
      { key: 'code', header: 'Code', cell: (r) => r.code },
    ];
    render(
      <DataTable columns={columns} rows={[{ code: 'X' }, { code: 'Y' }]} rowKey={(r) => r.code} />,
    );
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByText('Y')).toBeInTheDocument();
  });
});

/** Re-render into a clean document, for the one test that needs two trees in sequence. */
function cleanupAndRender(ui: React.ReactElement): void {
  document.body.innerHTML = '';
  render(ui);
}
