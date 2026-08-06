/**
 * AbstractOutboxRelay unit tests — the shared relay loop (pass coalescing, per-row error
 * handling, retry/backoff, terminal 'failed' status, and the dead-letter field the CloudWatch
 * alarm matches). All four concrete relays inherit this behaviour — email, notifications,
 * webhook deliveries and the SQS outbox — so covering it once here covers all four.
 *
 * Ported from rally along with the backoff and metrics this file exercises. opshub had none
 * of it: the base class shipped with no spec at all, which is how a relay could burn its
 * whole retry budget in 25 seconds without a test noticing.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AbstractOutboxRelay,
  DEAD_LETTER_FIELD,
  type PostCommitTask,
} from './abstract-outbox-relay';
import type { DrizzleDB, DrizzleTx } from '../database/drizzle.provider';

interface TestRow {
  id: string;
  attempts: number;
  shouldFail: boolean;
}

/** Minimal concrete relay exposing hooks the tests can assert against. */
class TestRelay extends AbstractOutboxRelay<TestRow> {
  fetchBatchResult: TestRow[] = [];
  markFailedCalls: Array<{
    rowId: string;
    newAttempts: number;
    newStatus: 'pending' | 'failed';
    nextAttemptAt: Date;
  }> = [];
  markSentCalls: string[] = [];

  // Not `async`: opshub's eslint enforces @typescript-eslint/require-await, and a stub with
  // nothing to await would need a disable comment on each one.
  protected fetchBatch(): Promise<TestRow[]> {
    return Promise.resolve(this.fetchBatchResult);
  }

  protected processRow(row: TestRow): Promise<PostCommitTask | void> {
    return row.shouldFail ? Promise.reject(new Error(`row ${row.id} failed`)) : Promise.resolve();
  }

  protected markSent(_tx: DrizzleTx, rowId: string): Promise<void> {
    this.markSentCalls.push(rowId);
    return Promise.resolve();
  }

  protected markFailed(
    _tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    _lastError: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    this.markFailedCalls.push({ rowId, newAttempts, newStatus, nextAttemptAt });
    return Promise.resolve();
  }
}

function makeFakeDb(): DrizzleDB {
  return {
    transaction: async (cb: (tx: DrizzleTx) => Promise<void>) => cb({} as DrizzleTx),
  } as unknown as DrizzleDB;
}

describe('AbstractOutboxRelay.backoffDelayMs()', () => {
  it('doubles the delay per attempt starting at 30s, capped at 30 minutes', () => {
    const relay = new TestRelay(makeFakeDb());
    const delayFor = (n: number) =>
      (relay as unknown as { backoffDelayMs(n: number): number }).backoffDelayMs(n);

    expect(delayFor(1)).toBe(30_000); // 30s
    expect(delayFor(2)).toBe(60_000); // 1m
    expect(delayFor(3)).toBe(120_000); // 2m
    expect(delayFor(4)).toBe(240_000); // 4m
    expect(delayFor(5)).toBe(480_000); // 8m
    // Cap: a hypothetically larger maxAttempts must never exceed 30 minutes.
    expect(delayFor(20)).toBe(30 * 60_000);
  });
});

describe('AbstractOutboxRelay.relay() — retry/backoff wiring', () => {
  it('passes an increasing nextAttemptAt to markFailed on each failed attempt', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [{ id: 'row-1', attempts: 0, shouldFail: true }];

    const before = Date.now();
    await relay.relay();

    expect(relay.markFailedCalls).toHaveLength(1);
    const call = relay.markFailedCalls[0];
    expect(call.rowId).toBe('row-1');
    expect(call.newAttempts).toBe(1);
    expect(call.newStatus).toBe('pending');
    // attempt 1 → ~30s delay. Immediate retry is the defect this replaced: five of them
    // fit inside a brief outage, and the fifth dead-letters the row for good.
    expect(call.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 29_000);
    expect(call.nextAttemptAt.getTime()).toBeLessThanOrEqual(before + 31_000);
  });

  it('marks the row terminally failed once attempts reach maxAttempts', async () => {
    const relay = new TestRelay(makeFakeDb());
    // 5th attempt == maxAttempts
    relay.fetchBatchResult = [{ id: 'row-1', attempts: 4, shouldFail: true }];

    await relay.relay();

    expect(relay.markFailedCalls[0].newStatus).toBe('failed');
    expect(relay.markFailedCalls[0].newAttempts).toBe(5);
  });

  it('marks a successful row sent and does not call markFailed for it', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [{ id: 'row-ok', attempts: 0, shouldFail: false }];

    await relay.relay();

    expect(relay.markSentCalls).toEqual(['row-ok']);
    expect(relay.markFailedCalls).toHaveLength(0);
  });

  it('one failing row in a batch does not block the others', async () => {
    const relay = new TestRelay(makeFakeDb());
    relay.fetchBatchResult = [
      { id: 'row-bad', attempts: 0, shouldFail: true },
      { id: 'row-good', attempts: 0, shouldFail: false },
    ];

    await relay.relay();

    expect(relay.markSentCalls).toEqual(['row-good']);
    expect(relay.markFailedCalls.map((c) => c.rowId)).toEqual(['row-bad']);
  });

  it('coalesces racing calls into exactly one extra pass the callers await directly', async () => {
    const relay = new TestRelay(makeFakeDb());
    let resolveFirstFetch!: () => void;
    let fetchCallCount = 0;

    relay.fetchBatchResult = [];
    const relayAsAny = relay as unknown as { fetchBatch(): Promise<TestRow[]> };
    const originalFetch = relayAsAny.fetchBatch.bind(relay);
    vi.spyOn(relayAsAny, 'fetchBatch').mockImplementation(async () => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return originalFetch();
    });

    const firstRun = relay.relay();
    // Three more callers arrive mid-pass. All three must share ONE extra pass, and each
    // promise must resolve only once that shared pass has actually run.
    const secondRun = relay.relay();
    const thirdRun = relay.relay();
    const fourthRun = relay.relay();
    resolveFirstFetch();
    await Promise.all([firstRun, secondRun, thirdRun, fourthRun]);

    expect(fetchCallCount).toBe(2); // in-flight pass + one coalesced extra, not four
  });

  it('a write made just before a racing relay() call is visible to the pass it resolves on', async () => {
    // The guarantee the old boolean-flag design lacked: a caller racing an in-flight pass
    // got a promise that could resolve before any fetch able to see their write had run, so
    // `insert(); await relay(); expect(...)` was a coin flip.
    const relay = new TestRelay(makeFakeDb());
    let resolveFirstFetch!: () => void;

    relay.fetchBatchResult = [];
    const relayAsAny = relay as unknown as { fetchBatch(): Promise<TestRow[]> };
    vi.spyOn(relayAsAny, 'fetchBatch').mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveFirstFetch = resolve;
      });
      return []; // first pass sees nothing; the row below is written after it started
    });

    const firstRun = relay.relay();
    relay.fetchBatchResult = [
      { id: 'row-written-during-first-pass', attempts: 0, shouldFail: false },
    ];
    const secondRun = relay.relay();

    resolveFirstFetch();
    await Promise.all([firstRun, secondRun]);

    expect(relay.markSentCalls).toContain('row-written-during-first-pass');
  });
});

describe('DEAD_LETTER_FIELD', () => {
  it('uses the field name the infra actually filters on', () => {
    // Guards the rename: the alarm is worthless if the field drifts away from the pattern.
    expect(DEAD_LETTER_FIELD).toBe('outboxDeadLetter');

    // Searches the whole infra tree rather than naming a file, for the same reason
    // fail-open.spec.ts does: asserting on a path needs editing every time the Terraform is
    // reorganised, which is how a guard quietly stops guarding. What matters is that SOME
    // Terraform in this repo filters on the field the app emits.
    const infra = join(__dirname, '../../../..', 'infra');
    // --exclude-dir is not optional: .terraform holds cached provider binaries and module
    // copies, and scanning them blows the test timeout.
    const terraform = execFileSync(
      'grep',
      ['-rl', '--include=*.tf', '--exclude-dir=.terraform', `$.${DEAD_LETTER_FIELD}`, infra],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

    expect(
      terraform,
      `No Terraform under infra/ filters on ${DEAD_LETTER_FIELD}; a relay can exhaust its ` +
        `retries and lose work with nothing alarming, even though the app emits the field.`,
    ).not.toEqual([]);
  });
});
