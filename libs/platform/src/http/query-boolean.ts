import { z } from 'zod';

/**
 * A boolean QUERY PARAMETER, parsed the way a query string actually arrives.
 *
 * WHY `z.coerce.boolean()` IS WRONG HERE, AND WAS WRONG IN TWENTY PLACES. Coercion is
 * `Boolean(value)`, and every non-empty string is truthy — so `?includeRetired=false` parsed to
 * `true`, `?openOnly=0` parsed to `true`, and `?breachesOnly=no` parsed to `true`. A caller
 * explicitly turning a filter OFF got the filter turned ON.
 *
 * Measured on the running API before this existed:
 *
 *   GET /v1/training/courses                        → total 2   (retired hidden, correct)
 *   GET /v1/training/courses?includeRetired=false   → total 3   (retired SHOWN, wrong)
 *   GET /v1/training/courses?includeRetired=true    → total 3
 *
 * The bug is invisible from the API's own tests, because a test that wants the filter off simply
 * omits the parameter — which works. It only shows up from a client that sends its state every time,
 * which is what a UI with a toggle does.
 *
 * WHAT COUNTS AS TRUE is spelled out rather than inferred: `true`, `1`, `yes`, `on` (case-insensitive).
 * `false`, `0`, `no`, `off` and the empty string are false. Anything else is a VALIDATION ERROR rather
 * than a silent default, because `?openOnly=maybe` is a caller bug and answering it with a guess is how
 * you get a report somebody trusts and should not.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

export function queryBoolean() {
  return z.union([z.boolean(), z.string()]).transform((value, ctx) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    ctx.addIssue({
      code: 'custom',
      message: `Expected a boolean (true/false, 1/0, yes/no, on/off) — received '${value}'`,
    });
    return z.NEVER;
  });
}
