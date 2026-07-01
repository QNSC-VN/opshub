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
      expiresAt: input.expiresAt,
    });
  }

  async findByHash(hash: string): Promise<RefreshToken | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hash))
      .limit(1);
    return (row) ?? null;
  }

  async revokeById(id: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revoked: true })
      .where(eq(refreshTokens.id, id));
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
