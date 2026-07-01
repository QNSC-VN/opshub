import type { CreateRefreshTokenInput, RefreshToken } from '../refresh-token.types';

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

export interface IRefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<void>;
  findByHash(hash: string): Promise<RefreshToken | null>;
  /** Mark a single token as revoked (used after rotation or explicit logout). */
  revokeById(id: string): Promise<void>;
  /** Revoke all tokens sharing a family — triggered on reuse detection (theft). */
  revokeFamily(familyId: string): Promise<void>;
  /** Revoke all tokens for an employee (force logout / offboarding). */
  revokeAllForEmployee(employeeId: string): Promise<void>;
  /** Delete expired/revoked tokens older than N days — run periodically to keep the table lean. */
  deleteExpiredBefore(date: Date): Promise<void>;
}
