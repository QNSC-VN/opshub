import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Query-ordering ratchet — every ORDER BY must be a TOTAL order.
 *
 * `ORDER BY x` where `x` is not unique leaves tied rows in an order SQL does not define.
 * Postgres returns whatever the scan yields, and an UPDATE that relocates a tuple to
 * another page silently changes it. Under `LIMIT`/`OFFSET` pagination that is not a
 * cosmetic wobble — rows are duplicated onto one page and dropped from every page.
 *
 * Measured on this schema before the fix, with 30 audit rows sharing one `occurred_at`
 * (what a batch insert produces) and one concurrent UPDATE between page fetches:
 *
 *     no tiebreaker  -> returned=30  distinct=25  duplicated=5  never_shown=5
 *     with tiebreaker-> returned=30  distinct=30  duplicated=0  never_shown=0
 *
 * So a user paging through audit logs, assets, employees or notifications while anyone
 * edits a record never sees 5 of 30 rows, and no error is raised anywhere.
 *
 * `LIMIT 1` is affected too, and more subtly: `.orderBy(desc(scoreDate)).limit(1)` with
 * tied dates returns an ARBITRARY row among them, so "the latest snapshot" is whichever
 * tuple the scan reached first.
 *
 * The rule enforced here: the final argument of every `.orderBy(...)` is a unique column —
 * a surrogate `id`, or a column that is itself a primary key or uniquely indexed.
 * Redundant on a sort that is already unique, and free: Postgres never compares the
 * tiebreaker unless every preceding key is equal.
 *
 * Baseline is ZERO and must stay there. The fix is always to append the tiebreaker, never
 * to add an exemption.
 */

// ── Baseline — MUST stay 0 ───────────────────────────────────────────────────
const MAX_PARTIAL_ORDERINGS = 0;

/** Sanity floor: if the scanner stops finding queries, fail loudly, not silently. */
const MIN_ORDER_BYS_FOUND = 30;

const ROOT = join(__dirname, '..');

/**
 * Columns that are unique WITHOUT being called `id`, so ending on one is already a total
 * order. Each is a primary key or carries a unique index — checked in db/schema, not
 * assumed:
 *
 *   - `permissions.key`   PRIMARY KEY (db/schema/authz.ts)
 *   - `roles.key`         uniqueIndex('uq_role_key')
 *   - `attachments.fileId` part of PRIMARY KEY (entity_type, entity_id, file_id)
 *                          (db/schema/storage.ts, migration 0018)
 *
 * Extending this list is a claim about the SCHEMA. Verify the constraint exists before
 * adding one, because a wrong entry here silently exempts a broken query.
 *
 * `attachments.fileId` carries a CONDITION worth stating, because it is weaker than the other
 * two. It is unique only WITHIN one `(entity_type, entity_id)` pair — the same file may be
 * attached to two different entities — and it is listed here because every query in
 * `entity-attachments.service.ts` filters on both of those columns first, which makes the
 * remaining ordering total. A future query that orders by `file_id` WITHOUT pinning the entity
 * would be exempted by this entry and should not be: order such a query by the entity columns
 * too, or it is genuinely partial.
 */
const UNIQUE_NON_ID_COLUMNS = ['permissions.key', 'roles.key', 'attachments.fileId'] as const;

interface Ordering {
  file: string;
  line: number;
  text: string;
}

/**
 * Extract the full `.orderBy(...)` call starting at `lines[i]`, balancing parentheses so a
 * call split across lines is captured whole.
 */
function readCall(lines: string[], i: number): string {
  let depth = 0;
  let started = false;
  let text = '';
  for (let j = i; j < Math.min(i + 20, lines.length); j++) {
    const from = j === i ? lines[j].indexOf('.orderBy(') : 0;
    for (const ch of lines[j].slice(from)) {
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') depth--;
      text += ch;
      if (started && depth === 0) return text.replace(/\s+/g, ' ').trim();
    }
    text += ' ';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Split call arguments on top-level commas only (nested calls contain commas). */
function splitTopLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of args) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function scanOrderBys(): { all: Ordering[]; partial: Ordering[] } {
  const files = execFileSync('git', ['ls-files', 'libs', 'apps', 'db'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.ts') && !f.includes('.spec.') && !f.includes('.test.'))
    // `git ls-files` lists TRACKED paths, which is not the same as paths on disk: a file
    // deleted but not yet staged, or absent mid-rebase, is listed and unreadable. Reading it
    // threw ENOENT and took the whole ratchet down — a crash rather than a verdict, which is
    // the one outcome a smoke detector must not have. An absent file cannot hold a violation.
    .filter((f) => existsSync(join(ROOT, f)));

  const all: Ordering[] = [];
  const partial: Ordering[] = [];

  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    if (!source.includes('.orderBy(')) continue;
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('.orderBy(')) continue;

      const text = readCall(lines, i);
      const ordering = { file, line: i + 1, text };
      all.push(ordering);

      const args = text.slice(text.indexOf('(') + 1, -1);
      const parts = splitTopLevel(args);
      const lastArg = parts.at(-1) ?? '';

      /**
       * An aggregate query's GROUP BY keys ARE the unique key of its result set, so
       * ordering by them is already total and appending a row id would not even compile —
       * the column is not in the grouping.
       *
       * Detected by looking BACK for a `.groupBy(` in the same statement rather than
       * anywhere in the file, so an aggregate elsewhere cannot excuse a plain list query.
       * The window ends at the previous statement boundary (`;`).
       */
      const before = lines.slice(Math.max(0, i - 20), i).join('\n');
      const statement = before.slice(before.lastIndexOf(';') + 1);
      if (statement.includes('.groupBy(')) continue;

      const endsUnique =
        /\.id\b/.test(lastArg) ||
        UNIQUE_NON_ID_COLUMNS.some(
          (c) => lastArg.includes(`.${c.split('.')[1]}`) && lastArg.includes(c.split('.')[0]),
        );
      if (!endsUnique) partial.push(ordering);
    }
  }

  return { all, partial };
}

describe('query-ordering ratchet (must stay at zero)', () => {
  it('finds the query surface it claims to guard', () => {
    const { all } = scanOrderBys();
    expect(
      all.length,
      'Found almost no ORDER BY clauses. The scanner is broken, not the repositories.',
    ).toBeGreaterThanOrEqual(MIN_ORDER_BYS_FOUND);
  });

  it('every ORDER BY ends in a unique column', () => {
    const { partial } = scanOrderBys();

    if (partial.length > MAX_PARTIAL_ORDERINGS) {
      const report = partial.map((o) => `  ${o.file}:${o.line}\n      ${o.text}`).join('\n');
      throw new Error(
        `${partial.length} ORDER BY clause(s) do not end in a unique column.\n` +
          `Tied rows then come back in physical-tuple order, which changes on the next ` +
          `UPDATE — so a paginated list duplicates some rows and never shows others, and ` +
          `LIMIT 1 picks an arbitrary row among the ties. Append the table's id.\n\n${report}`,
      );
    }

    expect(partial.length).toBe(0);
  });
});
