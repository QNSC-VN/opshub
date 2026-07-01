import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { auditLogs } from '../../../../../../db/schema';
import type { IAuditRepository } from '../../domain/ports/audit.repository';
import type { AuditFilters, AuditLog, CreateAuditLogInput } from '../../domain/audit.types';

@Injectable()
export class AuditDrizzleRepository implements IAuditRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      id: input.id,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      changes: input.changes ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async list(
    filters: AuditFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLog[]; total: number }> {
    const conditions = [
      filters.actorId ? eq(auditLogs.actorId, filters.actorId) : undefined,
      filters.resourceType ? eq(auditLogs.resourceType, filters.resourceType) : undefined,
      filters.resourceId ? eq(auditLogs.resourceId, filters.resourceId) : undefined,
      filters.action ? eq(auditLogs.action, filters.action) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);

    return { rows: rows, total: count };
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const result = await this.db
      .delete(auditLogs)
      .where(lt(auditLogs.occurredAt, before))
      .returning({ id: auditLogs.id });
    return result.length;
  }
}
