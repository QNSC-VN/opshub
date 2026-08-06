/**
 * Outbox relay E2E — the DB-to-SQS leg, end to end, against a real Postgres and a real
 * SQS endpoint (LocalStack, `docker compose -f docker-compose.dev.yml up -d`).
 *
 * This is the test the leg never had. Every other check in the repo stops at the outbox
 * table, so `SendMessage` first ran for real in a deployed environment — and the unit
 * spec beside the relay stubs the SQS client, which means it proves the command is built
 * correctly and nothing about whether a message actually lands on a queue.
 *
 * rally is the cautionary case for treating that gap as harmless: its equivalent leg was
 * asserted at both ends and never in the middle, and the middle turned out to drop 100%
 * of events in every deployed environment for as long as it existed, with a clean error
 * metric throughout. See `docs/DIVERGENCE.md`.
 *
 * What this asserts, in one pass:
 *   1. a pending row is published and marked `sent`
 *   2. the MESSAGE ON THE QUEUE carries the event's fields — not just that `send()` was
 *      called with them
 *   3. a row already `sent` is not republished
 *
 * Prereqs: the compose stack up (Postgres 5433, LocalStack 4567) and `.env` carrying
 * `AWS_ENDPOINT_URL` + `SQS_OUTBOX_URL`, exactly as `.env.example` ships them.
 */
import { randomUUID } from 'node:crypto';
import {
  DeleteMessageCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestingModule } from '@nestjs/testing';
import type { DrizzleDB } from '@platform';
import { outboxEvents } from '../../db/schema';
import { bootOutboxRelay } from './support/harness';
import type { OutboxRelayService } from '../../apps/worker/src/outbox/outbox-relay.service';

const QUEUE_URL = process.env['SQS_OUTBOX_URL'];
const ENDPOINT = process.env['AWS_ENDPOINT_URL'];

// A spec that silently skips is a spec that stops being true without telling anyone, so
// this fails loudly instead: if the leg cannot be exercised, that is the finding.
if (!QUEUE_URL || !ENDPOINT) {
  throw new Error(
    'SQS_OUTBOX_URL and AWS_ENDPOINT_URL must be set to run the outbox e2e. ' +
      'Copy them from .env.example and start the compose stack.',
  );
}

describe('outbox relay → SQS (real queue)', () => {
  let module: TestingModule;
  let relay: OutboxRelayService;
  let db: DrizzleDB;
  let sqs: SQSClient;

  beforeAll(async () => {
    const booted = await bootOutboxRelay();
    module = booted.module;
    relay = booted.relay;
    db = booted.db;

    sqs = new SQSClient({
      region: process.env['AWS_REGION'] ?? 'ap-southeast-1',
      endpoint: ENDPOINT,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    // Start from an empty queue: a leftover message from a previous run would satisfy the
    // receive below without this run having published anything.
    await sqs.send(new PurgeQueueCommand({ QueueUrl: QUEUE_URL }));
  });

  afterAll(async () => {
    sqs?.destroy();
    await module?.close();
  });

  /** Insert a pending event shaped exactly as OutboxService.enqueue writes one. */
  async function enqueue() {
    const [row] = await db
      .insert(outboxEvents)
      .values({
        id: randomUUID(),
        aggregateType: 'request',
        aggregateId: randomUUID(),
        eventType: 'request.submitted',
        payload: { requestId: 'e2e-req', priority: 'high' },
      })
      .returning();
    return row;
  }

  /** Long-poll for a message, so a slow LocalStack is a wait and not a failure. */
  async function receiveOne() {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
      }),
    );
    return res.Messages ?? [];
  }

  it('publishes a pending event to the queue and marks the row sent', async () => {
    const row = await enqueue();

    await relay.relay();

    const [after] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, row.id));
    expect(after?.status).toBe('sent');
    expect(after?.sentAt).not.toBeNull();
    expect(after?.attempts).toBe(0);
    expect(after?.lastError).toBeNull();

    const messages = await receiveOne();
    const mine = messages.filter((m) => (m.Body ?? '').includes(row.id));
    expect(mine).toHaveLength(1);
    expect(JSON.parse(mine[0].Body!)).toEqual({
      id: row.id,
      aggregateType: 'request',
      aggregateId: row.aggregateId,
      eventType: 'request.submitted',
      payload: { requestId: 'e2e-req', priority: 'high' },
    });

    for (const m of messages) {
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }),
      );
    }
  });

  it('does not republish a row that is already sent', async () => {
    const row = await enqueue();
    await relay.relay();
    for (const m of await receiveOne()) {
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }),
      );
    }

    // Second pass with nothing pending: the WHERE clause must exclude the sent row, or
    // every tick would redeliver the entire history of the table.
    await relay.relay();

    const again = (await receiveOne()).filter((m) => (m.Body ?? '').includes(row.id));
    expect(again).toHaveLength(0);
  });
});
