/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Free-text search goes through `searchAcross`, so the user's input stays text.
 *
 * WHAT WAS WRONG. Thirteen repositories built the same predicate by hand, in two different styles,
 * and none escaped the pattern:
 *
 *     ilike(assets.assetTag, `%${filters.search}%`)
 *     sql`${risks.title} ILIKE ${'%' + filters.search + '%'}`
 *
 * Both parameterize, so neither was an injection — the value never reaches the SQL text. But `%` and
 * `_` are wildcards INSIDE the value: `?search=%` matched every row, `?search=_` matched almost every
 * row, and a reader searching for a literal underscore — which every reference code in this product
 * contains — got matches unrelated to what they typed. A search that silently means "everything"
 * hands back a page of plausible results and no reason to doubt them.
 *
 * WHY A RATCHET AND NOT ONLY THE HELPER. The helper fixes today's thirteen. The next searchable list
 * is written by someone reaching for `ilike(col, `%${term}%`)`, which is the obvious thing to write
 * and looks right — that is how two styles of the same bug ended up here in the first place. This
 * fails the moment one reappears.
 *
 * BASELINE ZERO, and it is enforceable because the helper covers every case the repositories need:
 * one column or several, `SQL | undefined` so a blank term drops the filter rather than becoming
 * `%%`. If a genuine case ever needs a raw pattern, `likeContains` is exported for it and the escape
 * still happens.
 *
 * __dirname, not import.meta.dirname: this suite runs as CommonJS.
 */

const ROOT = join(__dirname, '..');

/** The file that owns the escaping, and so is the one place allowed to name these primitives. */
const HELPER = 'libs/platform/src/database/search.ts';

/** `ilike(` from drizzle, or a raw `ILIKE` in a `sql` template. */
const PREDICATE = /\bilike\s*\(|\bILIKE\b/;

/**
 * A pattern built by interpolation: `` `%${x}%` `` or `'%' + x + '%'`.
 *
 * This is the actual defect — a predicate is fine, an UNESCAPED pattern is not — so the two are
 * matched separately and both must be present for a line to count.
 */
const INTERPOLATED_PATTERN = /%\$\{|'%'\s*\+|\+\s*'%'/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

function scan(): { searched: string[]; offenders: Offender[] } {
  /*
   * `--others --exclude-standard` as well as the index, because a NEW file is the likeliest place for
   * a fresh violation and a bare `git ls-files` cannot see one until it is staged. The first run of
   * this ratchet failed for exactly that reason: the helper it guards was untracked, so the scan
   * found nothing and the floor caught it.
   */
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'libs', 'apps', 'db'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => !/\.(spec|e2e)\.tsx?$/.test(f))
    .filter((f) => !f.includes('/generated/'))
    // `git ls-files` reports the INDEX, so a file deleted but not yet staged is listed and
    // unreadable. Reading it throws ENOENT and takes the ratchet down — a crash instead of a
    // verdict. Same guard the sibling ratchets carry.
    .filter((f) => existsSync(join(ROOT, f)));

  const searched: string[] = [];
  const offenders: Offender[] = [];

  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    if (!PREDICATE.test(source)) continue;
    searched.push(file);
    if (file === HELPER) continue;

    source.split('\n').forEach((line, index) => {
      if (PREDICATE.test(line) && INTERPOLATED_PATTERN.test(line)) {
        offenders.push({ file, line: index + 1, text: line.trim().slice(0, 120) });
      }
    });
  }

  return { searched, offenders };
}

describe('search escaping', () => {
  it('finds the helper it claims to guard', () => {
    /*
     * The floor is the HELPER, not a count of offenders.
     *
     * Every other floor I could write here is satisfied by an empty repository: zero files using
     * ILIKE means zero violations. What must be true is that the one file allowed to build patterns
     * still exists and still builds them — if `search.ts` is deleted or renamed, every call site
     * breaks at compile time, but this ratchet would go green.
     */
    const { searched } = scan();
    expect(searched, 'the search helper is gone — nothing is escaping anything').toContain(HELPER);

    const helper = readFileSync(join(ROOT, HELPER), 'utf8');
    expect(helper).toMatch(PREDICATE);
    expect(helper, 'the helper no longer escapes the LIKE wildcards').toContain('[\\\\%_]');
  });

  it('has no hand-built LIKE pattern outside the helper', () => {
    const { offenders } = scan();

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line}\n      ${o.text}`).join('\n');
      throw new Error(
        `${offenders.length} hand-built LIKE pattern(s) outside ${HELPER}.\n` +
          `\`%\` and \`_\` are wildcards inside the VALUE, so \`?search=%\` matches every row and a ` +
          `search for a literal underscore matches anything. Use \`searchAcross(term, ...columns)\`, ` +
          `or \`likeContains(term)\` if you genuinely need the pattern.\n\n${report}`,
      );
    }

    expect(offenders.length).toBe(0);
  });

  it('routes every searchable repository through the helper', () => {
    // The converse of the check above: a repository that filters on a `search` field and does NOT
    // import the helper is either not searching at all or searching some other way.
    const files = execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        'libs/modules/**/*.drizzle-repository.ts',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => existsSync(join(ROOT, f)));

    const searching = files.filter((f) =>
      /filters\.(search|actorEmail|vendor)\b/.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    // Floor: if this list empties, the regex broke rather than the repositories improving.
    expect(searching.length).toBeGreaterThanOrEqual(8);

    const notUsingHelper = searching.filter(
      (f) => !readFileSync(join(ROOT, f), 'utf8').includes('searchAcross'),
    );
    expect(
      notUsingHelper,
      `These repositories filter on a free-text field without the helper:\n  ` +
        notUsingHelper.join('\n  '),
    ).toEqual([]);
  });
});
