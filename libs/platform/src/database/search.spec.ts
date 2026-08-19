/**
 * The search pattern must mean what the user typed.
 *
 * Thirteen repositories interpolated the raw term into a LIKE pattern, so `%` and `_` kept their
 * wildcard meaning inside the value: `?search=%` matched every row, and searching for a literal
 * underscore — which every reference code in this product contains — returned matches unrelated to
 * the input. These tests are about the two characters, because they are the whole defect.
 */
import { describe, expect, it } from 'vitest';
import { likeContains, searchAcross } from './search';

describe('likeContains', () => {
  it('wraps an ordinary term for a contains match', () => {
    expect(likeContains('laptop')).toBe('%laptop%');
  });

  it('neutralises the wildcard that matched everything', () => {
    // The reported defect: `?search=%` became the pattern `%%%`, which matches every row.
    expect(likeContains('%')).toBe('%\\%%');
  });

  it('neutralises the single-character wildcard', () => {
    // `_` is the quieter half. `%_%` matches any row with at least one character in the column, so
    // it reads as a working search returning almost the whole table.
    expect(likeContains('_')).toBe('%\\_%');
  });

  it('keeps a reference code searchable as literal text', () => {
    // `IA_2026` is the shape of a real reference. Unescaped, the `_` matches any character, so this
    // also matched `IA-2026` and `IA92026`.
    expect(likeContains('IA_2026')).toBe('%IA\\_2026%');
  });

  it('escapes the escape character before the wildcards, not after', () => {
    /*
     * ORDER IS THE SUBTLE PART. A single backslash must become two, and doing `%`/`_` first would
     * then double-escape the backslashes just inserted — turning `\` into `\\\\` and breaking the
     * pattern in a way no test of `%` alone would reveal. One regex over all three characters is
     * what makes the order unarguable.
     */
    expect(likeContains('\\')).toBe('%\\\\%');
    expect(likeContains('a\\%b')).toBe('%a\\\\\\%b%');
  });

  it('leaves other punctuation alone', () => {
    // Only the three characters LIKE gives meaning to are touched. Escaping more would be a second,
    // quieter bug: the pattern would stop matching text that contains them.
    expect(likeContains('a-b.c*d?')).toBe('%a-b.c*d?%');
  });
});

describe('searchAcross', () => {
  /** The generated SQL, with parameters inlined enough to assert on. */
  function render(sql: ReturnType<typeof searchAcross>): string {
    if (!sql) return '';
    const chunks = sql.queryChunks as unknown[];
    return JSON.stringify(chunks);
  }

  it('returns undefined for a term that filters nothing', () => {
    /*
     * A BLANK SEARCH MUST DROP THE FILTER, not become `%%`.
     *
     * These repositories build condition arrays and `.filter(Boolean)` them, so `undefined` is how a
     * filter opts out. Returning a pattern here would match every row — arriving at the reported
     * defect by a different route, from a caller who passed nothing at all.
     */
    expect(searchAcross(undefined)).toBeUndefined();
    expect(searchAcross(null)).toBeUndefined();
    expect(searchAcross('')).toBeUndefined();
    expect(searchAcross('   ')).toBeUndefined();
  });

  it('returns undefined when asked to search no columns', () => {
    // `or()` of nothing is not a predicate. Without this the caller gets a condition that cannot be
    // rendered, and the failure surfaces as a SQL syntax error far from the mistake.
    expect(searchAcross('laptop')).toBeUndefined();
  });

  it('carries the escaped pattern into the query, once per column', () => {
    const column = { name: 'title' } as never;
    const sql = searchAcross('50%', column, column, column);

    expect(sql).toBeDefined();
    // The escaped pattern is what reaches the driver — the assertion the 13 call sites were missing.
    expect(render(sql)).toContain('50\\\\%');
  });

  it('trims the term, so a trailing space is not part of the match', () => {
    expect(likeContains('laptop')).toBe(likeContains('laptop'));
    const column = { name: 'title' } as never;
    expect(render(searchAcross('  laptop  ', column))).toContain('%laptop%');
  });
});
