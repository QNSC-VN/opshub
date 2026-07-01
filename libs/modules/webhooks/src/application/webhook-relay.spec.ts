/**
 * WebhookRelayService unit tests.
 *
 * Tests HMAC-SHA256 signature generation, correct HTTP headers, and exponential
 * backoff delay calculation — all without a real HTTP server or database.
 *
 * Strategy:
 *  - `processRow()` is protected, so we expose it via a thin test subclass.
 *  - `markFailed()` and `markSent()` are similarly exposed.
 *  - `fetch` is replaced with a vi.stubGlobal() spy so we can control responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookRelayService } from './webhook-relay.service';
import type { DrizzleTx } from '@platform';

// ── Test subclass exposing protected methods ──────────────────────────────────

class TestableRelayService extends WebhookRelayService {
  public exposedProcessRow(row: Parameters<WebhookRelayService['processRow']>[0]) {
    return this.processRow(row);
  }

  public exposedMarkSent(tx: DrizzleTx, rowId: string) {
    return this.markSent(tx, rowId);
  }

  public exposedMarkFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    error: string,
  ) {
    return this.markFailed(tx, rowId, newAttempts, newStatus, error);
  }

  public exposedFetchBatch(tx: DrizzleTx) {
    return this.fetchBatch(tx);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    subscriptionId: 'sub-1',
    eventType: 'request.approved',
    payload: { requestId: 'req-abc', type: 'leave' },
    attempts: 0,
    url: 'https://example.com/webhook',
    secret: 'super-secret-key-with-16-chars!!',
    ...overrides,
  };
}

function makeMockDb() {
  const updateChain: Record<string, ReturnType<typeof vi.fn>> = {
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
  };
  updateChain.update.mockReturnValue(updateChain);
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);

  return {
    update: updateChain.update,
    // eslint-disable-next-line @typescript-eslint/require-await
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(updateChain)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebhookRelayService — HMAC signature', () => {
  let service: TestableRelayService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const db = makeMockDb();
    service = new TestableRelayService(db as never);

    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends POST with Content-Type: application/json', async () => {
    await service.exposedProcessRow(makeRow());
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('includes X-OpsHub-Event header matching the event type', async () => {
    const row = makeRow({ eventType: 'request.rejected' });
    await service.exposedProcessRow(row);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-OpsHub-Event']).toBe('request.rejected');
  });

  it('includes X-OpsHub-Delivery header matching the delivery id', async () => {
    const row = makeRow({ id: 'del-xyz' });
    await service.exposedProcessRow(row);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['X-OpsHub-Delivery']).toBe('del-xyz');
  });

  it('generates a valid HMAC-SHA256 signature for the exact body sent', async () => {
    const row = makeRow();
    let capturedBody = '';
    let capturedSig = '';

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
      capturedSig = (opts.headers as Record<string, string>)['X-OpsHub-Signature'];
      return Promise.resolve({ ok: true });
    });

    await service.exposedProcessRow(row);

    const expectedSig = `sha256=${createHmac('sha256', row.secret).update(capturedBody).digest('hex')}`;
    expect(capturedSig).toBe(expectedSig);
  });

  it('body JSON contains id, eventType, payload, and timestamp fields', async () => {
    const row = makeRow({ id: 'del-123', eventType: 'request.submitted' });
    let parsedBody: Record<string, unknown> = {};

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    mockFetch.mockImplementation((_: string, opts: RequestInit) => {
      parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      return Promise.resolve({ ok: true });
    });

    await service.exposedProcessRow(row);

    expect(parsedBody).toMatchObject({
      id: 'del-123',
      eventType: 'request.submitted',
      payload: { requestId: 'req-abc', type: 'leave' },
    });
    expect(typeof parsedBody['timestamp']).toBe('string');
    // timestamp must be ISO 8601
    expect(() => new Date(parsedBody['timestamp'] as string).toISOString()).not.toThrow();
  });

  it('posts to the correct URL from the row', async () => {
    const row = makeRow({ url: 'https://hooks.myapp.io/receive' });
    await service.exposedProcessRow(row);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('https://hooks.myapp.io/receive');
  });

  it('throws when the server responds with a non-2xx status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(service.exposedProcessRow(makeRow())).rejects.toThrow('HTTP 503');
  });

  it('throws when fetch rejects (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.exposedProcessRow(makeRow())).rejects.toThrow('ECONNREFUSED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Exponential backoff delay calculation
// ═════════════════════════════════════════════════════════════════════════════

describe('WebhookRelayService — markFailed() backoff delays', () => {
  // RETRY_DELAYS_SECONDS = [60, 300, 900, 3600]
  const EXPECTED_DELAYS = [60, 300, 900, 3600];

  let service: TestableRelayService;
  let updateChain: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    updateChain = {
      update: vi.fn(),
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.update.mockReturnValue(updateChain);
    updateChain.set.mockReturnValue(updateChain);

    service = new TestableRelayService({ update: updateChain.update } as never);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  for (let attempt = 1; attempt <= 4; attempt++) {
    it(`sets nextAttemptAt ≈ now + ${EXPECTED_DELAYS[attempt - 1]}s on attempt ${attempt}`, async () => {
      const before = Date.now();
      await service.exposedMarkFailed(
        updateChain as never,
        'del-1',
        attempt,
        'pending',
        'some error',
      );
      const after = Date.now();

      const setArgs = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
      const nextAt = (setArgs?.['nextAttemptAt'] as Date).getTime();
      const expectedDelay = (EXPECTED_DELAYS[attempt - 1] ?? 3600) * 1000;

      expect(nextAt).toBeGreaterThanOrEqual(before + expectedDelay - 50);
      expect(nextAt).toBeLessThanOrEqual(after + expectedDelay + 50);
    });
  }

  it('sets status=failed when newAttempts >= maxAttempts (5)', async () => {
    await service.exposedMarkFailed(updateChain as never, 'del-1', 5, 'failed', 'error');
    const setArgs = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs?.['status']).toBe('failed');
  });

  it('sets status=pending for intermediate failures', async () => {
    await service.exposedMarkFailed(updateChain as never, 'del-1', 2, 'pending', 'error');
    const setArgs = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs?.['status']).toBe('pending');
  });

  it('truncates lastError to 2000 characters', async () => {
    const longError = 'x'.repeat(3000);
    await service.exposedMarkFailed(updateChain as never, 'del-1', 1, 'pending', longError);
    const setArgs = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((setArgs?.['lastError'] as string).length).toBe(2000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// markSent()
// ═════════════════════════════════════════════════════════════════════════════

describe('WebhookRelayService — markSent()', () => {
  it('sets status=delivered and deliveredAt to now', async () => {
    const chain = {
      update: vi.fn(),
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    chain.update.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);

    const service = new TestableRelayService({ update: chain.update } as never);

    const before = Date.now();
    await service.exposedMarkSent(chain as never, 'del-1');
    const after = Date.now();

    const setArgs = chain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs?.['status']).toBe('delivered');
    const deliveredAt = (setArgs?.['deliveredAt'] as Date).getTime();
    expect(deliveredAt).toBeGreaterThanOrEqual(before - 50);
    expect(deliveredAt).toBeLessThanOrEqual(after + 50);
  });
});
