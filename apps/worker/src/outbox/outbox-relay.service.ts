import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { asc, eq } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB, AppConfigService } from '@platform';
import { outboxEvents } from '../../../../db/schema';

const BATCH_SIZE = 50;

/**
 * Outbox relay — polls unpublished domain events and forwards them to SQS
 * (or logs them when no queue is configured, e.g. local dev), then marks
 * them published. Guarantees at-least-once delivery.
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

  @Interval(5000)
  async relay(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.published, false))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(BATCH_SIZE);

      for (const event of batch) {
        await this.publish(event);
        await this.db
          .update(outboxEvents)
          .set({ published: true, publishedAt: new Date() })
          .where(eq(outboxEvents.id, event.id));
      }

      if (batch.length > 0) {
        this.logger.log(`Relayed ${batch.length} outbox event(s)`);
      }
    } catch (err) {
      this.logger.error({ err }, 'Outbox relay failed');
    } finally {
      this.running = false;
    }
  }

  private async publish(event: typeof outboxEvents.$inferSelect): Promise<void> {
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
