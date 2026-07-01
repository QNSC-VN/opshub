export interface RefreshToken {
  id: string;
  employeeId: string;
  tokenHash: string;
  /** Groups all rotated tokens from the same login chain. Used for theft detection. */
  familyId: string;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateRefreshTokenInput {
  id: string;
  employeeId: string;
  /** SHA-256 hex hash of the raw token. */
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}
