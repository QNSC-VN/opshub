import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { queryBoolean } from './query-boolean';

/**
 * The cases `z.coerce.boolean()` got wrong, pinned.
 *
 * Written from a measured defect rather than from the type: `?includeRetired=false` returned retired
 * courses on the live API, because coercion is `Boolean('false')` and that is `true`. Twenty query
 * filters across training, ISMS, QMS, documents, licences and positions shared the bug, and every one of
 * them was reachable from a UI toggle that sends its state on every request.
 */
describe('queryBoolean', () => {
  const schema = z.object({ flag: queryBoolean().optional() });

  it('reads the strings a query string actually carries as FALSE', () => {
    // This is the whole point of the helper. `Boolean('false')` is `true`, so each of these used to
    // turn a filter ON when the caller asked for it OFF.
    for (const value of ['false', 'FALSE', '0', 'no', 'off', '', '  false  ']) {
      expect(schema.parse({ flag: value }), `'${value}' should be false`).toEqual({ flag: false });
    }
  });

  it('reads the usual true spellings as TRUE', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(schema.parse({ flag: value }), `'${value}' should be true`).toEqual({ flag: true });
    }
  });

  it('passes a real boolean through, for a non-HTTP caller', () => {
    expect(schema.parse({ flag: true })).toEqual({ flag: true });
    expect(schema.parse({ flag: false })).toEqual({ flag: false });
  });

  it('REFUSES a value it cannot read rather than guessing', () => {
    // `?openOnly=maybe` is a caller bug. Defaulting it either way produces a report somebody trusts
    // and should not.
    const result = schema.safeParse({ flag: 'maybe' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('Expected a boolean');
  });

  it('leaves an absent parameter absent', () => {
    // `undefined` is not `false`: several filters treat "not asked" differently from "asked for off",
    // and `.optional()` has to keep that distinction.
    expect(schema.parse({})).toEqual({});
  });

  it('composes with .default(), which one licence filter relies on', () => {
    const withDefault = z.object({ flag: queryBoolean().default(false) });
    expect(withDefault.parse({})).toEqual({ flag: false });
    expect(withDefault.parse({ flag: 'false' })).toEqual({ flag: false });
    expect(withDefault.parse({ flag: 'true' })).toEqual({ flag: true });
  });
});
