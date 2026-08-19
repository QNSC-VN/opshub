import { type SQL, ilike, or } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * Free-text search that treats the user's input as TEXT.
 *
 * WHY THIS EXISTS. Thirteen repositories built the same predicate by hand, in two different styles,
 * and not one of them escaped the pattern:
 *
 *     ilike(assets.assetTag, `%${filters.search}%`)
 *     sql`${risks.title} ILIKE ${'%' + filters.search + '%'}`
 *
 * Both parameterize, so neither was an injection — the value never reaches the SQL text. But `%` and
 * `_` are wildcards INSIDE the value, so `?search=%` matched every row in the table, `?search=_`
 * matched almost every row, and a reader searching for a literal underscore — which every reference
 * code in this product contains — got matches that had nothing to do with what they typed.
 *
 * A search that silently means "everything" is worse than one that errors: the caller gets a page of
 * plausible results and no reason to doubt them, and on a large table it is a full scan anybody can
 * ask for.
 *
 * THE ESCAPE CHARACTER IS THE BACKSLASH, which is Postgres's default for LIKE and ILIKE, so no
 * `ESCAPE` clause is needed. The backslash itself has to be escaped FIRST — replacing it after `%`
 * and `_` would double-escape the backslashes this function just inserted.
 */
const LIKE_WILDCARDS = /[\\%_]/g;

/**
 * `term` as a LIKE pattern matching it anywhere in a column, with every wildcard neutralised.
 *
 * Exported for the few callers that need the pattern rather than the predicate; prefer
 * {@link searchAcross}, which cannot be combined wrongly.
 */
export function likeContains(term: string): string {
  return `%${term.replace(LIKE_WILDCARDS, (char) => `\\${char}`)}%`;
}

/**
 * One `OR` of case-insensitive contains-matches across `columns`.
 *
 * Replaces both hand-rolled styles with one shape, so a new searchable list is a call rather than a
 * predicate somebody writes from memory — which is how the two styles diverged in the first place.
 *
 * Returns `undefined` for an empty or whitespace-only term, so a caller can drop it straight into the
 * `.filter(Boolean)` condition arrays these repositories already use. A blank search must widen to
 * "no filter", never to a pattern of `%%` that matches everything by a different route.
 */
export function searchAcross(
  term: string | null | undefined,
  ...columns: AnyColumn[]
): SQL | undefined {
  if (!term?.trim()) return undefined;
  if (columns.length === 0) return undefined;

  const pattern = likeContains(term.trim());
  // `or()` with one argument returns that condition unwrapped, so a single-column search stays a
  // plain ILIKE rather than a one-branch disjunction.
  return or(...columns.map((column) => ilike(column, pattern)));
}
