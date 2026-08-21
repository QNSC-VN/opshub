import { inArray } from 'drizzle-orm';
import { employees } from '../../../../db/schema';
import type { DbExecutor } from '../database/drizzle.provider';

/**
 * Resolve employee ids to display names, in ONE query.
 *
 * WHY THIS EXISTS. The SPA showed a raw uuid wherever a record pointed at a person: the Owner column
 * on controlled documents, the Employee column on contracts, the reviewer on a performance review,
 * the acknowledgement list on a policy version, the holder of a licence seat. Every one of those is a
 * column whose whole job is to say WHO, answered with 36 characters that say nothing — and worse than
 * nothing when the ids are uuid v7, because a time-prefix makes several rows look alike.
 *
 * The mirror image of this was already fixed on the way IN. `EntityPicker` exists because four forms
 * asked the user to TYPE a uuid; nobody knows an employee's uuid, so those forms worked in a demo and
 * not in use. This is the same defect on the way out.
 *
 * WHY THE SERVER RESOLVES IT rather than the SPA. `GET /v1/employees` is gated on `employee.read`, so
 * a caller who may read a risk but not the directory would get a 403 and a dash — the roles that hold
 * an ISMS bundle without a directory bundle are exactly the ones who need the owner's name. Resolving
 * it beside the record also costs no extra round trip and cannot go stale between two responses.
 *
 * WHY A FUNCTION AND NOT AN INJECTABLE. Every caller already holds a `DrizzleDB`, and a service would
 * need registering in fifteen modules to do exactly this one query. Takes a `DbExecutor`, so a caller
 * inside a transaction passes its `tx` and reads its own uncommitted writes.
 *
 * NOT A JOIN, on purpose. A record outlives the person it points at, and an inner join would drop the
 * record along with the employee row — losing a contract because its holder was deleted is a far
 * worse failure than showing no name. Ids with no row are simply absent from the map.
 */
export async function resolveEmployeeNames(
  db: DbExecutor,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  // Deduplicated because a page of twenty rows filed by three people is three ids, and NULLs dropped
  // because `inArray(col, [])` is not valid SQL — an unassigned record must not cost a query at all.
  const unique = [
    ...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: employees.id, displayName: employees.displayName })
    .from(employees)
    .where(inArray(employees.id, unique));

  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/**
 * The display name for `id`, or null.
 *
 * A named helper rather than `map.get(id) ?? null` at every call site: the fallback has to be null and
 * not the id. Falling back to the uuid would put back exactly what this set of changes removes, and it
 * is a one-character mistake to make in a `??`.
 */
export function nameOf(names: Map<string, string>, id: string | null | undefined): string | null {
  return (id && names.get(id)) ?? null;
}
