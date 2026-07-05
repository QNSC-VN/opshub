/**
 * NotificationRelayService — polls notification_outbox and dispatches in-app
 * notifications via NotificationsService.
 *
 * Extends AbstractOutboxRelay which owns the polling loop, concurrency guard,
 * transaction management, and retry/fail logic.
 *
 * Adaptive polling:
 *   NotificationSchedulerService.schedule() publishes a relay:wake signal to
 *   Redis immediately after writing to notification_outbox.  onModuleInit()
 *   subscribes and calls super.relay() directly — delivery latency drops from
 *   ≤5s (cron) to ~ms (wake signal).  The 5s cron is the catch-all fallback.
 *
 * Post-commit SSE push:
 *   processRow() returns a PostCommitTask that publishes to Redis AFTER the
 *   transaction commits so the SSE controller never receives an event before
 *   in_app_notifications is durable.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform';
import type { PostCommitTask } from '@platform';
import {
  renderNotification,
  NotificationPubSubService,
} from '@platform/notifications';
import type { NotificationTemplateName, NotificationTemplateVars } from '@platform/notifications';
import { notificationOutbox } from '../../../../../db/schema';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

type NotificationOutboxRow = {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  vars: unknown;
  resourceId: string | null;
  attempts: number;
  idempotencyKey: string | null;
};

@Injectable()
export class NotificationRelayService
  extends AbstractOutboxRelay<NotificationOutboxRow>
  implements OnModuleInit, OnModuleDestroy
{
  private unsubscribeRelayWake?: () => Promise<void>;

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly notificationsService: NotificationsService,
    private readonly pubSub: NotificationPubSubService,
    private readonly prefs: NotificationPreferencesService,
  ) {
    super(db);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Notification relay started — polling notification_outbox every 5s');
    this.unsubscribeRelayWake = await this.pubSub.subscribeRelayWake(() => {
      this.relay().catch((err: unknown) =>
        this.logger.error({ err }, 'Notification relay triggered by wake signal failed'),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRelayWake?.();
  }

  @Cron('*/5 * * * * *', { name: 'notification-relay' })
  override async relay(): Promise<void> {
    return super.relay();
  }

  // ── AbstractOutboxRelay implementation ────────────────────────────────────

  protected async fetchBatch(tx: DrizzleTx): Promise<NotificationOutboxRow[]> {
    return tx
      .select({
        id:             notificationOutbox.id,
        recipientId:    notificationOutbox.recipientId,
        actorId:        notificationOutbox.actorId,
        type:           notificationOutbox.type,
        vars:           notificationOutbox.vars,
        resourceId:     notificationOutbox.resourceId,
        attempts:       notificationOutbox.attempts,
        idempotencyKey: notificationOutbox.idempotencyKey,
      })
      .from(notificationOutbox)
      .where(and(eq(notificationOutbox.status, 'pending'), lt(notificationOutbox.attempts, this.maxAttempts), lte(notificationOutbox.scheduledAt, new Date())))
      .orderBy(asc(notificationOutbox.scheduledAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: NotificationOutboxRow): Promise<PostCommitTask | void> {
    // Check in-app preference before dispatching.
    const inAppEnabled = await this.prefs.isInAppEnabled(row.recipientId, row.type);
    if (!inAppEnabled) {
      this.logger.debug({ recipientId: row.recipientId, type: row.type }, 'In-app notification suppressed by preference');
      return; // AbstractOutboxRelay marks the row as sent (dispatched)
    }

    const type    = row.type as NotificationTemplateName;
    const vars    = row.vars as NotificationTemplateVars[typeof type];
    const rendered = renderNotification(type, vars as never);

    const notification = await this.notificationsService.send({
      recipientId:   row.recipientId,
      actorId:       row.actorId    ?? undefined,
      type,
      title:         rendered.title,
      body:          rendered.body,
      resourceId:    row.resourceId ?? undefined,
      sourceEventId: row.idempotencyKey ?? row.id,
    });

    // If notification was deduplicated (already exists), no SSE push needed.
    if (!notification) return;

    return async () => {
      await this.pubSub.notifyUser({
        notificationId: notification.id,
        recipientId:    row.recipientId,
        type,
        title:          rendered.title,
        body:           rendered.body,
        resourceId:     row.resourceId ?? undefined,
      });
    };
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(notificationOutbox)
      .set({ status: 'sent', dispatchedAt: new Date() })
      .where(eq(notificationOutbox.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void> {
    await tx
      .update(notificationOutbox)
      .set({ attempts: newAttempts, status: newStatus, lastError })
      .where(eq(notificationOutbox.id, rowId));
  }
}
