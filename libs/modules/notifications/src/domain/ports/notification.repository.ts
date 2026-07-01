import type { DbExecutor } from '@platform';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilters,
  NotificationListResult,
} from '../notification.types';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface INotificationRepository {
  create(input: CreateNotificationInput, executor?: DbExecutor): Promise<Notification>;
  findById(id: string): Promise<Notification | null>;
  list(recipientId: string, filters: NotificationListFilters): Promise<NotificationListResult>;
  markRead(id: string, recipientId: string): Promise<void>;
  markAllRead(recipientId: string): Promise<void>;
  unreadCount(recipientId: string): Promise<number>;
  existsBySourceEventId(sourceEventId: string): Promise<boolean>;
}
