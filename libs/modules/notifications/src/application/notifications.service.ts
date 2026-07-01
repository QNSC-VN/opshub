import { Inject, Injectable } from '@nestjs/common';
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

  async send(input: CreateNotificationInput): Promise<Notification | null> {
    // Deduplication: if a notification with this sourceEventId was already
    // delivered, skip silently. This is the idempotency guard on the write path.
    if (input.sourceEventId) {
      const exists = await this.repo.existsBySourceEventId(input.sourceEventId);
      if (exists) return null;
    }
    return this.repo.create(input);
  }

  list(
    recipientId: string,
    filters: NotificationListFilters,
  ): Promise<NotificationListResult> {
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
