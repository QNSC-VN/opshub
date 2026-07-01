import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB, type DbExecutor } from '@platform';
import { newId } from '@shared-kernel';
import { accessRequests, accessGrants } from '../../../../../../db/schema';
import type { IAccessRequestRepository } from '../../domain/ports/access-request.repository';
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestFilters,
  CreateAccessRequestInput,
} from '../../domain/access-request.types';

@Injectable()
export class AccessRequestDrizzleRepository implements IAccessRequestRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateAccessRequestInput): Promise<AccessRequest> {
    const [row] = await this.db
      .insert(accessRequests)
      .values({
        id: newId(),
        requesterId: input.requesterId,
        accessType: input.accessType,
        target: input.target,
        justification: input.justification,
        durationHours: String(input.durationHours),
        requestId: input.requestId ?? null,
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<AccessRequest | null> {
    const [row] = await this.db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.id, id))
      .limit(1);
    return (row) ?? null;
  }

  async list(
    filters: AccessRequestFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AccessRequest[]; total: number }> {
    const conditions = [
      filters.requesterId ? eq(accessRequests.requesterId, filters.requesterId) : undefined,
      filters.status ? eq(accessRequests.status, filters.status) : undefined,
    ].filter(Boolean);
    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(accessRequests)
      .where(where)
      .orderBy(desc(accessRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(accessRequests)
      .where(where);

    return { rows: rows, total: count };
  }

  async approve(
    requestId: string,
    reviewerId: string,
    note: string | null,
    grant: Omit<AccessGrant, 'revokedAt'>,
    tx: DbExecutor,
  ): Promise<void> {
    await tx
      .update(accessRequests)
      .set({
        status: 'approved',
        reviewerId,
        reviewNote: note,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accessRequests.id, requestId));
    await tx.insert(accessGrants).values({
      id: grant.id,
      requestId: grant.requestId,
      granteeId: grant.granteeId,
      accessType: grant.accessType,
      target: grant.target,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
    });
  }

  async reject(requestId: string, reviewerId: string, note: string | null): Promise<void> {
    await this.db
      .update(accessRequests)
      .set({
        status: 'rejected',
        reviewerId,
        reviewNote: note,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accessRequests.id, requestId));
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.db
      .update(accessGrants)
      .set({ revokedAt: new Date() })
      .where(eq(accessGrants.id, grantId));
  }

  async findGrantById(grantId: string): Promise<AccessGrant | null> {
    const [row] = await this.db
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.id, grantId))
      .limit(1);
    return (row) ?? null;
  }

  async listActiveGrants(granteeId: string): Promise<AccessGrant[]> {
    const rows = await this.db
      .select()
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.granteeId, granteeId),
          isNull(accessGrants.revokedAt),
          gt(accessGrants.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(accessGrants.grantedAt));
    return rows;
  }
}
