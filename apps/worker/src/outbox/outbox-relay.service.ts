/**
 * OutboxRelayService — polls `messaging.outbox_events` for pending domain events and
 * forwards them to SQS.
 *
 * Extends AbstractOutboxRelay, which owns the polling loop, the coalescing guard,
 * transaction management, and the retry / dead-letter logic. This class provides only
 * the SQS-specific behaviour: what to SELECT, how to publish, and how to mark rows.
 *
 * It used to hand-roll all of that, and the base class it should have been the archetype
 * of was already being used by the email, notification and webhook relays. Three things
 * came back with it:
 *
 *   - `outboxDeadLetter` on the TERMINAL failure. A domain event that exhausted its five
 *     attempts was previously invisible to the CloudWatch metric filter that watches
 *     every other relay, so the one relay whose failures nobody could see was this one.
 *   - Wake-on-complete. A row inserted while a batch was already running waited a full
 *     5s tick instead of being picked up as soon as the pass finished.
 *   - An honest success count. The old log line counted
 *     `batch.filter((e) => e.attempts < MAX_ATTEMPTS).length`, which is the WHERE clause
 *     of the query that produced the batch — always the whole batch, and unaffected by
 *     failures, because a failure never mutates the in-memory row. "Relayed 50 outbox
 *     event(s)" printed even when all 50 publishes threw.
 *
 * Delivery guarantee: at-least-once. Consumers must be idempotent on the event `id`.
 *
 * NOTE: nothing consumes `opshub-outbox` yet, so a published message expires unread at
 * the queue's 4-day retention. That is a topology decision recorded in
 * `docs/DIVERGENCE.md`, not a defect in this relay — but it does mean this code path has
 * never delivered anything to anybody, which is exactly the situation in which the
 * defects above went unnoticed.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { and, asc, eq, lt } from 'drizzle-orm';
import {
  InjectDrizzle,
  type DrizzleDB,
  type DrizzleTx,
  AppConfigService,
  AbstractOutboxRelay,
  buildAwsClientConfig,
  Span,
} from '@platform';
import { outboxEvents } from '../../../../db/schema';

type OutboxEventRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
};

@Injectable()
export class OutboxRelayService
  extends AbstractOutboxRelay<OutboxEventRow>
  implements OnModuleInit
{
  private readonly sqs: SQSClient;
  private readonly queueUrl?: string;

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly config: AppConfigService,
  ) {
    super(db);
    // Region-only against real AWS; endpoint + static credentials when
    // AWS_ENDPOINT_URL points at LocalStack. See buildAwsClientConfig.
    this.sqs = new SQSClient(buildAwsClientConfig(this.config));
    this.queueUrl = this.config.get('SQS_OUTBOX_URL');
  }

  onModuleInit(): void {
    // ONCE, at boot, at warn level. Without a queue URL every event is acked without
    // being published, and the old code said so per-event at `debug` — invisible under
    // the default LOG_LEVEL=info, so an environment silently discarding its whole event
    // stream looked identical to one delivering it. rally's relay warns the same way.
    if (!this.queueUrl) {
      this.logger.warn(
        'SQS_OUTBOX_URL not set — outbox events will be acked WITHOUT publishing (dev mode)',
      );
    } else {
      this.logger.log(`Outbox relay → SQS ${this.queueUrl}`);
    }
  }

  /** Runs every 5 seconds. */
  @Cron('*/5 * * * * *', { name: 'outbox-relay' })
  @Span('outbox.relay')
  override async relay(): Promise<void> {
    return super.relay();
  }

  // ── AbstractOutboxRelay implementation ────────────────────────────────────

  protected async fetchBatch(tx: DrizzleTx): Promise<OutboxEventRow[]> {
    return tx
      .select({
        id: outboxEvents.id,
        aggregateType: outboxEvents.aggregateType,
        aggregateId: outboxEvents.aggregateId,
        eventType: outboxEvents.eventType,
        payload: outboxEvents.payload,
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'pending'), lt(outboxEvents.attempts, this.maxAttempts)))
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: OutboxEventRow): Promise<void> {
    if (!this.queueUrl) return; // acked without publishing; warned about at boot

    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          id: row.id,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          payload: row.payload,
        }),
      }),
    );
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(outboxEvents)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(outboxEvents.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
    // outbox_events has no scheduled_at / next_attempt_at column, so this relay cannot defer
    // a retry — it re-reads on the next 5s tick. Adding the column is the way to give it
    // real backoff; until then the base class's value has nowhere to go.
    _nextAttemptAt: Date,
  ): Promise<void> {
    await tx
      .update(outboxEvents)
      .set({ status: newStatus, attempts: newAttempts, lastError })
      .where(eq(outboxEvents.id, rowId));
  }
}
