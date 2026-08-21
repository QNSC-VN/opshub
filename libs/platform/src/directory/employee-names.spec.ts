import { describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { nameOf, resolveEmployeeNames } from './employee-names';
import type { DbExecutor } from '../database/drizzle.provider';

/*
 * `inArray` is spied on so the test can read the id LIST the query was built with.
 *
 * Not by inspecting the built SQL: a drizzle condition holds a reference back to the table it came
 * from, so `JSON.stringify` on it throws "Converting circular structure to JSON" — which is how the
 * first version of the case below failed. The real behaviour still runs; only the argument is read.
 */
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual, inArray: vi.fn(actual.inArray) };
});

/**
 * A query chain that resolves on `where`, which is where this query ends, and records how many times
 * `select` was called.
 *
 * The count is the whole point of the unit test: the response a caller builds is byte-identical
 * whether twenty names were fetched in one query or in twenty, so nothing observable from outside
 * separates the correct implementation from the obvious wrong one.
 */
function makeDb(rows: { id: string; displayName: string }[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  const select = vi.fn(() => chain);
  return { db: { select } as unknown as DbExecutor, select, chain };
}

describe('resolveEmployeeNames', () => {
  it('resolves a page of ids in ONE query', async () => {
    const { db, select } = makeDb([
      { id: 'a', displayName: 'Ada' },
      { id: 'b', displayName: 'Bo' },
    ]);

    const names = await resolveEmployeeNames(db, ['a', 'b', 'a', 'b', 'a']);

    expect(names.get('a')).toBe('Ada');
    expect(names.get('b')).toBe('Bo');
    expect(
      select.mock.calls.length,
      'more than one select means the names are being fetched per row',
    ).toBe(1);
  });

  it('asks for each id once, however many rows point at it', async () => {
    /*
     * Twenty rows filed by three people is three ids. Asserted on the ARGUMENT rather than only on
     * the query count, because a duplicate-laden `in (...)` list still costs one query — it just
     * grows without bound on a wide page, and `inArray` with a thousand repeats is a real plan.
     */
    const { db } = makeDb([{ id: 'a', displayName: 'Ada' }]);
    vi.mocked(inArray).mockClear();

    await resolveEmployeeNames(
      db,
      Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? 'a' : 'b')),
    );

    // Two distinct ids reached the query; the eighteen repeats did not.
    expect(vi.mocked(inArray).mock.calls[0]?.[1]).toEqual(['a', 'b']);
  });

  it('makes NO query when there is nothing to resolve', async () => {
    /*
     * `inArray(col, [])` is not valid SQL, so this is a crash and not merely a waste — and a list of
     * unassigned records is the ordinary case, not an edge one. Nullish entries are dropped for the
     * same reason: `assigneeId` is nullable nearly everywhere it appears.
     */
    const { db, select } = makeDb([]);

    expect((await resolveEmployeeNames(db, [])).size).toBe(0);
    expect((await resolveEmployeeNames(db, [null, undefined, ''])).size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it('leaves an id with no employee row out of the map', async () => {
    /*
     * A record outlives the person it points at. The absence has to be representable, because the
     * alternative — an inner join — would drop the CONTRACT along with the employee row.
     */
    const { db } = makeDb([{ id: 'a', displayName: 'Ada' }]);

    const names = await resolveEmployeeNames(db, ['a', 'gone']);

    expect(names.has('gone')).toBe(false);
    expect(nameOf(names, 'gone')).toBeNull();
  });
});

describe('nameOf', () => {
  it('answers null rather than the id when the name is unknown', () => {
    /*
     * The one thing this helper is for. `map.get(id) ?? id` is a one-character mistake that puts the
     * uuid straight back into the column this whole change removes it from.
     */
    const names = new Map([['a', 'Ada']]);

    expect(nameOf(names, 'a')).toBe('Ada');
    expect(nameOf(names, 'missing')).toBeNull();
    expect(nameOf(names, null)).toBeNull();
    expect(nameOf(names, undefined)).toBeNull();
  });
});
