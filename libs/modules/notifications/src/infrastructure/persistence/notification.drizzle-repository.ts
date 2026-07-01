import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB, type DbExecutor } from '@platform';
import { inAppNotifications } from '../../../../../../db/schema';
import type { INotificationRepository } from '../../domain/ports/notification.repository';
import type {
  Notification,
  CreateNotificationInput,
  NotificationListFilters,
  NotificationListResult,
} from '../../domain/notification.types';

@Injectable()
export class NotificationDrizzleRepository implements INotificationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  private get executor(): DbExecutor { return this.db; }

  async create(input: CreateNotificationInput, executor?: DbExecutor): Promise<Notification> {
    const db = (executor ?? this.executor) as DrizzleDB;
    const [row] = await db.insert(inAppNotifications).values({
      recipientId:   input.recipientId,
      actorId:       input.actorId       ?? null,
      type:          input.type,
      title:         input.title,
      body:          input.body          ?? null,
      resourceType:  input.resourceType  ?? null,
      resourceId:    input.resourceId    ?? null,
      metadata:      input.metadata      ?? {},
      sourceEventId: input.sourceEventId ?? null,
    }).returning();
    return this.mapRow(row);
  }

  async findById(id: string): Promise<Notification | null> {
    const [row] = await this.db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.id, id))
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async list(recipientId: string, filters: NotificationListFilters): Promise<NotificationListResult> {
    const conditions = [
      eq(inAppNotifications.recipientId, recipientId),
      ...(filters.isRead !== undefined ? [eq(inAppNotifications.isRead, filters.isRead)] : []),
      ...(filters.cursor ? [lt(inAppNotifications.createdAt, new Date(atob(filters.cursor)))] : []),
    ];

    const rows = await this.db
      .select()
      .from(inAppNotifications)
      .where(and(...conditions))
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(filters.limit + 1);

    const hasMore = rows.length > filters.limit;
    const items   = rows.slice(0, filters.limit).map((r) => this.mapRow(r));
    const nextCursor = hasMore
      ? btoa(items[items.length - 1].createdAt.toISOString())
      : null;

    return { items, nextCursor };
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotifications.id, id),
          eq(inAppNotifications.recipientId, recipientId),
        ),
      );
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.db
      .update(inAppNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(inAppNotifications.recipientId, recipientId),
          eq(inAppNotifications.isRead, false),
        ),
      );
  }

  async unreadCount(recipientId: string): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.recipientId, recipientId),
          eq(inAppNotifications.isRead, false),
        ),
      );
    return count;
  }

  async existsBySourceEventId(sourceEventId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.sourceEventId, sourceEventId))
      .limit(1);
    return !!row;
  }

  private mapRow(row: typeof inAppNotifications.$inferSelect): Notification {
    return {
      id:            row.id,
      recipientId:   row.recipientId,
      actorId:       row.actorId,
      type:          row.type,
      title:         row.title,
      body:          row.body,
      resourceType:  row.resourceType,
      resourceId:    row.resourceId,
      metadata:      row.metadata,
      isRead:        row.isRead,
      readAt:        row.readAt,
      createdAt:     row.createdAt,
      sourceEventId: row.sourceEventId,
    };
  }
}
