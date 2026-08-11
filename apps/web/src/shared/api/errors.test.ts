import { describe, expect, it } from 'vitest';
import { apiErrorMessage, responseErrorMessage } from './errors';

/**
 * The API's message beats ours, and only ours survives when there is nothing to read.
 *
 * Written after a screen showed "The employee may already have an active contract." for a 412 whose real
 * message was "has no signature date" — a paraphrase that named the one cause it was not. These cases are
 * the shapes that actually reach the client: the error envelope, a body with no envelope, and no body.
 */
describe('apiErrorMessage', () => {
  it('returns the message the API sent', () => {
    const envelope = {
      error: { code: 'CONTRACT_NOT_SIGNED', message: 'Contract PW-1 has no signature date.' },
    };
    expect(apiErrorMessage(envelope, 'Failed.')).toBe('Contract PW-1 has no signature date.');
  });

  it('falls back when there is no envelope to read', () => {
    // A network failure gives `undefined`; a proxy 502 gives HTML that the client parses to nothing.
    expect(apiErrorMessage(undefined, 'Failed.')).toBe('Failed.');
    expect(apiErrorMessage(null, 'Failed.')).toBe('Failed.');
    expect(apiErrorMessage('Bad Gateway', 'Failed.')).toBe('Failed.');
    expect(apiErrorMessage({ message: 'top level' }, 'Failed.')).toBe('Failed.');
  });

  it('falls back on a blank message rather than showing an empty toast', () => {
    expect(apiErrorMessage({ error: { message: '   ' } }, 'Failed.')).toBe('Failed.');
    expect(apiErrorMessage({ error: { message: 42 } }, 'Failed.')).toBe('Failed.');
  });
});

describe('responseErrorMessage', () => {
  it('reads the envelope out of a Response', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'Already clocked in.' } }), {
      status: 409,
    });
    await expect(responseErrorMessage(res, 'Clock-in failed.')).resolves.toBe(
      'Already clocked in.',
    );
  });

  it('falls back when the body is not JSON', async () => {
    const res = new Response('<html>502</html>', { status: 502 });
    await expect(responseErrorMessage(res, 'Clock-in failed.')).resolves.toBe('Clock-in failed.');
  });
});
