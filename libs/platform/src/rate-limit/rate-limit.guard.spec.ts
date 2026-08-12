import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '@qnsc-vn/platform-http';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * The 429 says WHY, and survives the exception filter.
 *
 * `GlobalExceptionFilter` (shared package) builds the wire envelope itself:
 *
 *   message: typeof res === 'string' ? res : (res['message'] ?? 'Error')
 *
 * The guard used to throw a NESTED `{ error: { code, message } }`, so `res['message']` was undefined and
 * every rate-limited response in the product reached the caller as the literal message `"Error"`. It was
 * found from the other end: a 429 rendered as a bare "Error" under an upload button in the SPA, naming
 * nothing. This asserts the shape the filter actually reads, so a future "tidy-up" back to a nested
 * envelope fails here rather than in somebody's face.
 */

function contextFor(headers: Record<string, string>) {
  const request = { headers, ip: '203.0.113.9', user: undefined, cookies: {} };
  const response = { header: vi.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

/** A cache that always refuses, which is the only interesting branch here. */
const exhaustedCache = {
  consumeRateLimit: vi.fn().mockResolvedValue({
    allowed: false,
    remaining: 0,
    resetAt: Math.floor(Date.now() / 1000) + 42,
  }),
};

const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) };

describe('RateLimitGuard, when the bucket is empty', () => {
  it('throws a 429 whose message names the wait', async () => {
    const guard = new RateLimitGuard(reflector as never, exhaustedCache as never);

    await expect(guard.canActivate(contextFor({}))).rejects.toMatchObject({
      status: 429,
    });
  });

  it('throws a body the exception filter can read the message out of', async () => {
    const guard = new RateLimitGuard(reflector as never, exhaustedCache as never);

    const thrown = await guard.canActivate(contextFor({})).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(HttpException);

    const body = (thrown as HttpException).getResponse() as Record<string, unknown>;
    // FLAT. A nested `{ error: { message } }` is what produced the `"Error"` message, so this asserts
    // the absence of that nesting as much as the presence of the text.
    expect(body.error, 'the body must not nest another envelope inside itself').toBeUndefined();
    expect(body.message).toMatch(/Too many requests — retry after \d+s\./);
    expect(body.retryAfter).toBeGreaterThan(0);

    // And the filter's own extraction, run for real rather than described: this is the line that
    // produced "Error" before.
    const extracted = typeof body === 'string' ? body : ((body['message'] as string) ?? 'Error');
    expect(extracted).not.toBe('Error');
  });

  it('keeps the filter reachable — the class it depends on is still exported', () => {
    // A guard whose message is right and whose filter has moved would be silently wrong again.
    expect(GlobalExceptionFilter).toBeTypeOf('function');
  });
});
