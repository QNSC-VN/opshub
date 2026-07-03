import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { and, asc, eq, lt } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB, AppConfigService } from '@platform';
import { outboxEvents } from '../../../../db/schema';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

/**
 * Outbox relay — polls pending domain events and forwards them to SQS,
 * then marks them sent. Guarantees at-least-once delivery.
 *
 * Retry: up to MAX_ATTEMPTS retries with last_error recorded.
 * After MAX_ATTEMPTS failures the row moves to 'failed' and is excluded
 * from future polls (ops alert or manual replay required).
 *
 * FOR UPDATE SKIP LOCKED: safe for multiple worker replicas — each relay
 * instance claims its own exclusive batch without blocking peers.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly sqs: SQSClient;
  private readonly queueUrl?: string;
  private running = false;

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly config: AppConfigService,
  ) {
    this.sqs = new SQSClient({ region: this.config.get('AWS_REGION') });
    this.queueUrl = this.config.get('SQS_OUTBOX_URL');
  }

  @Cron('*/5 * * * * *', { name: 'outbox-relay' })
  async relay(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.transaction(async (tx) => {
        const batch = await tx
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.status, 'pending'), lt(outboxEvents.attempts, MAX_ATTEMPTS)))
          .orderBy(asc(outboxEvents.createdAt))
          .limit(BATCH_SIZE)
          .for('update', { skipLocked: true });

        if (batch.length === 0) return;

        for (const event of batch) {
          try {
            await this.#publish(event);
            await tx
              .update(outboxEvents)
              .set({ status: 'sent', sentAt: new Date() })
              .where(eq(outboxEvents.id, event.id));
          } catch (err) {
            const newAttempts = event.attempts + 1;
            await tx
              .update(outboxEvents)
              .set({
                attempts: newAttempts,
                lastError: String(err),
                status: newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
              })
              .where(eq(outboxEvents.id, event.id));
            this.logger.warn(
              { eventId: event.id, eventType: event.eventType, attempt: newAttempts, err },
              `Outbox event publish failed (attempt ${newAttempts}/${MAX_ATTEMPTS})`,
            );
          }
        }

        const sent = batch.filter((e) => e.attempts < MAX_ATTEMPTS).length;
        if (sent > 0) {
          this.logger.log(`Relayed ${sent} outbox event(s)`);
        }
      });
    } catch (err) {
      this.logger.error({ err }, 'Outbox relay transaction failed');
    } finally {
      this.running = false;
    }
  }

  async #publish(event: typeof outboxEvents.$inferSelect): Promise<void> {
    if (!this.queueUrl) {
      this.logger.debug(
        { eventType: event.eventType, aggregateId: event.aggregateId },
        'No SQS queue configured — logging event only',
      );
      return;
    }
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          id: event.id,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload,
        }),
      }),
    );
  }
}
