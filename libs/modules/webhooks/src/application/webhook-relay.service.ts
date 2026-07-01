import { Injectable } from '@nestjs/common';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { Cron } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { InjectDrizzle, AbstractOutboxRelay } from '@platform';
import type { DrizzleDB, DrizzleTx, PostCommitTask } from '@platform';
import { webhookDeliveries, webhookSubscriptions } from '../../../../../db/schema';

const WEBHOOK_TIMEOUT_MS = 10_000; // 10s per delivery attempt
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600]; // 1m → 5m → 15m → 1h
const MAX_DELIVERY_ERROR_LENGTH = 2_000; // chars stored in lastError column

type DeliveryRow = {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
};

/**
 * WebhookRelayService — polls `webhook_deliveries` and fires HTTP POST requests
 * to subscriber URLs with HMAC-SHA256 signatures.
 *
 * Signature header: `X-OpsHub-Signature: sha256=<hex>`
 * Body: JSON `{ id, eventType, payload, timestamp }`
 * Recipients verify: `sha256(secret, body) === header value`
 */
@Injectable()
export class WebhookRelayService extends AbstractOutboxRelay<DeliveryRow> {
  constructor(@InjectDrizzle() db: DrizzleDB) {
    super(db);
  }

  @Cron('*/10 * * * * *', { name: 'webhook-relay' })
  override async relay(): Promise<void> {
    return super.relay();
  }

  protected async fetchBatch(tx: DrizzleTx): Promise<DeliveryRow[]> {
    return tx
      .select({
        id: webhookDeliveries.id,
        subscriptionId: webhookDeliveries.subscriptionId,
        eventType: webhookDeliveries.eventType,
        payload: webhookDeliveries.payload,
        attempts: webhookDeliveries.attempts,
        url: webhookSubscriptions.url,
        secret: webhookSubscriptions.secret,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookSubscriptions,
        and(
          eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id),
          eq(webhookSubscriptions.active, true),
        ),
      )
      .where(
        and(
          eq(webhookDeliveries.status, 'pending'),
          lt(webhookDeliveries.attempts, this.maxAttempts),
          lte(webhookDeliveries.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: DeliveryRow): Promise<PostCommitTask | void> {
    const timestamp = new Date().toISOString();
    const body = JSON.stringify({
      id: row.id,
      eventType: row.eventType,
      payload: row.payload,
      timestamp,
    });

    const sig = `sha256=${createHmac('sha256', row.secret).update(body).digest('hex')}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpsHub-Signature': sig,
          'X-OpsHub-Event': row.eventType,
          'X-OpsHub-Delivery': row.id,
        },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(webhookDeliveries)
      .set({ status: 'delivered', deliveredAt: new Date() })
      .where(eq(webhookDeliveries.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    error: string,
  ): Promise<void> {
    const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(newAttempts - 1, RETRY_DELAYS_SECONDS.length - 1)] ?? 3600;
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
    await tx
      .update(webhookDeliveries)
      .set({
        status: newStatus,
        attempts: newAttempts,
        lastError: error.slice(0, MAX_DELIVERY_ERROR_LENGTH),
        nextAttemptAt: newStatus === 'failed' ? new Date() : nextAttemptAt,
      })
      .where(eq(webhookDeliveries.id, rowId));
  }
}
