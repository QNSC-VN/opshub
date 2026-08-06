/**
 * OutboxRelayService unit tests.
 *
 * Covers the three behaviours that changed when this relay moved onto
 * AbstractOutboxRelay, each of which was previously wrong in a way no test could see:
 *
 *  - a MISSING queue URL is announced once at boot at WARN, not per-event at debug
 *  - a configured queue URL produces one SendMessage with the event's own fields
 *  - a publish failure PROPAGATES, so the base class can retry and eventually
 *    dead-letter, rather than being swallowed into a success
 *
 * Strategy mirrors webhook-relay.spec.ts: `processRow` is protected, so a thin test
 * subclass exposes it, and the SQS client is replaced with a spy. No database and no
 * network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfigService, DrizzleDB } from '@platform';
import { OutboxRelayService } from './outbox-relay.service';

type Row = Parameters<OutboxRelayService['processRow']>[0];

class TestableRelay extends OutboxRelayService {
  public exposedProcessRow(row: Row) {
    return this.processRow(row);
  }

  /** Replace the SQS client with a spy; returns the spy's `send`. */
  public stubSqs(send: (cmd: unknown) => Promise<unknown>) {
    (this as unknown as { sqs: { send: typeof send } }).sqs = { send };
  }
}

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: '0192f2a0-0000-7000-8000-000000000001',
    aggregateType: 'request',
    aggregateId: '0192f2a0-0000-7000-8000-000000000002',
    eventType: 'request.submitted',
    payload: { requestId: 'req-1', priority: 'high' },
    attempts: 0,
    ...overrides,
  };
}

/** Minimal config double: only the keys this relay reads. */
function config(values: Record<string, string | undefined>): AppConfigService {
  return { get: (key: string) => values[key] } as unknown as AppConfigService;
}

const db = {} as DrizzleDB;

function makeRelay(queueUrl?: string) {
  const relay = new TestableRelay(
    db,
    config({ AWS_REGION: 'ap-southeast-1', SQS_OUTBOX_URL: queueUrl }),
  );
  const warn = vi.spyOn(relay['logger'], 'warn').mockImplementation(() => undefined);
  const log = vi.spyOn(relay['logger'], 'log').mockImplementation(() => undefined);
  return { relay, warn, log };
}

describe('OutboxRelayService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('boot-time announcement', () => {
    it('warns ONCE at warn level when SQS_OUTBOX_URL is unset', () => {
      const { relay, warn, log } = makeRelay(undefined);

      relay.onModuleInit();

      // Warn, not debug: the previous per-event debug line was invisible under the
      // default LOG_LEVEL=info, so an environment discarding every event looked
      // exactly like one delivering them.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/acked WITHOUT publishing/);
      expect(log).not.toHaveBeenCalled();
    });

    it('logs the target queue when configured, and does not warn', () => {
      const { relay, warn, log } = makeRelay('http://localhost:4567/000000000000/opshub-outbox');

      relay.onModuleInit();

      expect(warn).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0]).toContain('opshub-outbox');
    });
  });

  describe('processRow', () => {
    it('sends one message carrying the event fields', async () => {
      const { relay } = makeRelay('http://localhost:4567/000000000000/opshub-outbox');
      const send = vi.fn().mockResolvedValue({});
      relay.stubSqs(send);
      const row = makeRow();

      await relay.exposedProcessRow(row);

      expect(send).toHaveBeenCalledTimes(1);
      const input = (send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input;
      expect(input['QueueUrl']).toBe('http://localhost:4567/000000000000/opshub-outbox');
      expect(JSON.parse(input['MessageBody'] as string)).toEqual({
        id: row.id,
        aggregateType: 'request',
        aggregateId: row.aggregateId,
        eventType: 'request.submitted',
        payload: { requestId: 'req-1', priority: 'high' },
      });
      // `attempts` is relay bookkeeping, not part of the event contract.
      expect(input['MessageBody']).not.toContain('attempts');
    });

    it('publishes nothing when no queue is configured', async () => {
      const { relay } = makeRelay(undefined);
      const send = vi.fn().mockResolvedValue({});
      relay.stubSqs(send);

      await relay.exposedProcessRow(makeRow());

      expect(send).not.toHaveBeenCalled();
    });

    it('PROPAGATES a publish failure instead of swallowing it', async () => {
      const { relay } = makeRelay('http://localhost:4567/000000000000/opshub-outbox');
      relay.stubSqs(
        vi.fn().mockRejectedValue(new Error('AWS.SimpleQueueService.NonExistentQueue')),
      );

      // The throw is the contract: AbstractOutboxRelay turns it into markFailed, an
      // attempt increment and — on the fifth — an `outboxDeadLetter` log the CloudWatch
      // alarm matches. A caught-and-logged error here would mark the row sent and lose
      // the event with a clean log.
      await expect(relay.exposedProcessRow(makeRow())).rejects.toThrow(/NonExistentQueue/);
    });
  });
});
