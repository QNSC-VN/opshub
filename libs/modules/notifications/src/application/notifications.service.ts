import { Inject, Injectable } from '@nestjs/common';
import type { DbExecutor } from '@platform';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../domain/ports/notification.repository';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilters,
  NotificationListResult,
} from '../domain/notification.types';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  /**
   * Deliver one in-app notification, deduplicated on `sourceEventId`.
   *
   * PASS THE CALLER'S TRANSACTION. `NotificationRelayService` calls this from inside its relay
   * transaction, and until it did, this was a dual write with a nasty failure mode: the in-app row was
   * written on a separate connection, so a rollback of the relay transaction left the notification
   * DELIVERED while its outbox row went back to `pending`. The retry then found the row already
   * existed, returned null here, and skipped everything downstream of it — including the email
   * cascade. The notification appeared in the bell and its email was never sent, permanently, with no
   * error anywhere.
   *
   * The check and the write must share one executor for the same reason: the dedup read has to see
   * writes the surrounding transaction has not committed yet.
   */
  async send(input: CreateNotificationInput, executor?: DbExecutor): Promise<Notification | null> {
    if (input.sourceEventId) {
      const exists = await this.repo.existsBySourceEventId(input.sourceEventId, executor);
      if (exists) return null;
    }
    return this.repo.create(input, executor);
  }

  list(recipientId: string, filters: NotificationListFilters): Promise<NotificationListResult> {
    return this.repo.list(recipientId, filters);
  }

  markRead(id: string, recipientId: string): Promise<void> {
    return this.repo.markRead(id, recipientId);
  }

  markAllRead(recipientId: string): Promise<void> {
    return this.repo.markAllRead(recipientId);
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.repo.unreadCount(recipientId);
  }
}
