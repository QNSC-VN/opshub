import { Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { refreshTokens } from '../../../../../../db/schema';
import type { IRefreshTokenRepository } from '../../domain/ports/refresh-token.repository';
import type { CreateRefreshTokenInput, RefreshToken } from '../../domain/refresh-token.types';

@Injectable()
export class RefreshTokenDrizzleRepository implements IRefreshTokenRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateRefreshTokenInput): Promise<void> {
    await this.db.insert(refreshTokens).values({
      id: input.id,
      employeeId: input.employeeId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      authMethod: input.authMethod,
      expiresAt: input.expiresAt,
    });
  }

  async findByHash(hash: string): Promise<RefreshToken | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    return row ? (row as unknown as RefreshToken) : null;
  }

  async revokeById(id: string): Promise<void> {
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, id));
  }

  async revokeByIdIfActive(id: string): Promise<boolean> {
    // Conditional update = optimistic compare-and-swap. Only the request that
    // observes revoked=false flips it and gets a row back; concurrent racers get
    // zero rows and must not mint a competing token.
    const rows = await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(and(eq(refreshTokens.id, id), eq(refreshTokens.revoked, false)))
      .returning({ id: refreshTokens.id });
    return rows.length > 0;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.familyId, familyId));
  }

  async revokeAllForEmployee(employeeId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.employeeId, employeeId));
  }

  async deleteExpiredBefore(date: Date): Promise<void> {
    await this.db
      .delete(refreshTokens)
      .where(and(lt(refreshTokens.expiresAt, date), eq(refreshTokens.revoked, true)));
  }
}
