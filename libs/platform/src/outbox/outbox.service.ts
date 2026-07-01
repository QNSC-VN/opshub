import { Injectable } from '@nestjs/common';
import { newId } from '@shared-kernel';
import { outboxEvents } from '../../../../db/schema';
import type { DbExecutor } from '../database/drizzle.provider';

export interface OutboxMessage {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional Outbox — atomically records a domain event in the same
 * transaction as the state change. The worker relays unpublished rows to SQS
 * and marks them published, guaranteeing at-least-once delivery.
 *
 * Always call within the caller's transaction by passing the executor (`tx`).
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: DbExecutor, message: OutboxMessage): Promise<void> {
    await tx.insert(outboxEvents).values({
      id: newId(),
      aggregateType: message.aggregateType,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
    });
  }
}
