import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { UnauthorizedException, ErrorCodes, AppConfigService, CacheService } from '@platform';
import { MS_PER_DAY } from '@shared-kernel';
import { AuditService } from '@modules/audit';
import { AuthzAdminService } from '@modules/authz';
import { EMPLOYEE_REPOSITORY, type IEmployeeRepository } from '../domain/ports/employee.repository';
import {
  REFRESH_TOKEN_REPOSITORY,
  type IRefreshTokenRepository,
} from '../domain/ports/refresh-token.repository';
import type { Employee } from '../domain/employee.types';
import type { AuthMethod } from '../domain/refresh-token.types';

/** Shape returned by all login / refresh methods. */
export interface TokenResult {
  /** Short-lived JWT — return in JSON body; SPA stores in memory only. */
  accessToken: string;
  /** Seconds until the access token expires (typically 900 for 15 min). */
  expiresIn: number;
  /** Raw opaque refresh token — caller MUST write this to an HttpOnly cookie. Never log or return in JSON. */
  rawRefreshToken: string;
}

/**
 * Auth application service.
 *
 * Token strategy (enterprise-grade):
 *   - Access token:  15 min JWT, payload includes `sessionId` (= refresh_tokens.id).
 *                    Returned in JSON body. SPA stores in memory — never localStorage.
 *   - Refresh token: 7-day random token, delivered via HttpOnly Secure SameSite=Lax cookie only.
 *                    SHA-256 hash stored in DB. Rotated on every use.
 *   - Family ID:     Every login chain shares a `familyId`. If a revoked token is replayed,
 *                    the entire family is revoked (theft detection).
 *   - Fast revocation: On logout or offboard, sessionId/employeeId is cached in Redis with a
 *                    TTL matching the access token lifetime. JwtStrategy checks this on every request.
 */
@Injectable()
export class AuthService {
  /** TTL for session revocation cache entries = access token lifetime (15 min). */
  static readonly SESSION_REVOKE_TTL = 15 * 60; // seconds

  /** Convert a JWT expiry string like "15m", "8h", "1d" to seconds. */
  static parseExpiryToSeconds(expiry: string): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(expiry.trim());
    if (!match) return AuthService.SESSION_REVOKE_TTL;
    const n = parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return n;
      case 'm':
        return n * 60;
      case 'h':
        return n * 3600;
      case 'd':
        return n * 86400;
      default:
        return AuthService.SESSION_REVOKE_TTL;
    }
  }

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly authzAdmin: AuthzAdminService,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepo: IEmployeeRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async devLogin(email: string): Promise<TokenResult> {
    const employee = await this.employeeRepo.findByEmail(email.toLowerCase());
    if (!employee) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Unknown employee');
    }
    this.#assertActive(employee);
    const result = await this.#mintTokens(employee, randomUUID(), 'dev');

    await this.audit.record({
      actorId: employee.id,
      actorEmail: employee.email,
      action: 'auth.login.dev',
      resourceType: 'session',
      metadata: { email: employee.email },
    });

    return result;
  }

  async entraLogin(idToken: string): Promise<TokenResult> {
    const tenantId = this.config.get('ENTRA_TENANT_ID');
    const clientId = this.config.get('ENTRA_CLIENT_ID');

    if (!tenantId || !clientId) {
      throw new UnauthorizedException(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Entra SSO is not configured on this server',
      );
    }

    const jwksUrl = new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);
    const JWKS = createRemoteJWKSet(jwksUrl);

    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `https://sts.windows.net/${tenantId}/`,
        ],
        audience: clientId,
      });
      claims = payload;
    } catch {
      throw new UnauthorizedException(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Invalid Entra ID token',
      );
    }

    const oid = claims['oid'] as string | undefined;
    const email = (claims['preferred_username'] ?? claims['email'] ?? claims['upn']) as
      | string
      | undefined;
    const displayName = claims['name'] as string | undefined;
    // Entra App Roles claim — populated when the user is assigned roles in the app registration.
    // Falls back to ['employee'] so first-time SSO users always get at least read access.
    const entraRoles = Array.isArray(claims['roles'])
      ? (claims['roles'] as string[]).filter((r) => typeof r === 'string')
      : ['employee'];

    if (!oid || !email) {
      throw new UnauthorizedException(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Token missing oid or email claim',
      );
    }

    const employee = await this.employeeRepo.upsertByEntraOid(oid, {
      email: email.toLowerCase(),
      displayName: displayName ?? email.split('@')[0],
    });

    this.#assertActive(employee);

    // Reconcile the user's RBAC role assignments (the source of truth that
    // PolicyGuard reads) to match the Entra App Roles claim. Unknown role keys
    // are ignored (fail-safe). This also refreshes employees.roles for the JWT.
    // Effect: if IT changes a user's App Role in Entra, it applies at next login
    // with no OpsHub admin action.
    const effectiveRoles = await this.authzAdmin.syncUserRolesByKeys(employee.id, entraRoles, {
      sub: employee.id,
      email: employee.email,
    });

    const result = await this.#mintTokens({ ...employee, roles: effectiveRoles }, randomUUID(), 'sso');

    await this.audit.record({
      actorId: employee.id,
      actorEmail: employee.email,
      action: 'auth.login.sso',
      resourceType: 'session',
      metadata: { email: employee.email, entraOid: oid },
    });

    return result;
  }

  /**
   * Rotate the refresh token.
   *
   * - If the token is already revoked, the entire family is killed (theft detected).
   * - If the token is expired, throws 401.
   * - Otherwise: atomically revokes the old session and issues a new one in the same family.
   */
  async refresh(rawToken: string): Promise<TokenResult> {
    const hash = this.#hash(rawToken);
    const stored = await this.refreshTokenRepo.findByHash(hash);

    if (!stored) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid refresh token');
    }

    if (stored.revoked) {
      // Token reuse detected — revoke the entire family
      await this.refreshTokenRepo.revokeFamily(stored.familyId);
      await this.audit.record({
        actorId: stored.employeeId,
        action: 'auth.token_theft_detected',
        resourceType: 'session',
        resourceId: stored.familyId,
        metadata: { familyId: stored.familyId },
      });
      throw new UnauthorizedException(
        ErrorCodes.AUTH_INVALID_CREDENTIALS,
        'Refresh token reuse detected',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Refresh token expired');
    }

    await this.refreshTokenRepo.revokeById(stored.id);

    const employee = await this.employeeRepo.findById(stored.employeeId);
    if (!employee) {
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Employee not found');
    }
    this.#assertActive(employee);

    return this.#mintTokens(employee, stored.familyId, stored.authMethod);
  }

  /** Revoke the session — also fast-revokes the matching access token via cache. */
  async logout(rawToken: string, accessTokenExp?: number): Promise<void> {
    const hash = this.#hash(rawToken);
    const stored = await this.refreshTokenRepo.findByHash(hash);
    if (!stored || stored.revoked) return;

    await this.refreshTokenRepo.revokeById(stored.id);

    // Fast-revoke: block the access token for exactly its remaining lifetime.
    // Using payload.exp - now (exact TTL) means the cache entry never outlives the JWT.
    const ttlSeconds = accessTokenExp
      ? Math.max(1, accessTokenExp - Math.floor(Date.now() / 1000))
      : AuthService.SESSION_REVOKE_TTL;

    await this.cache.set(`revoked:session:${stored.id}`, '1', ttlSeconds);

    await this.audit.record({
      actorId: stored.employeeId,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: stored.id,
      metadata: { sessionId: stored.id },
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  #assertActive(employee: Employee): void {
    if (employee.status === 'offboarded') {
      throw new UnauthorizedException(ErrorCodes.EMPLOYEE_INACTIVE, 'Employee is offboarded');
    }
  }

  async #mintTokens(employee: Employee, familyId: string, authMethod: AuthMethod): Promise<TokenResult> {
    const sessionId = randomUUID();
    const rawRefreshToken = randomBytes(32).toString('base64url');
    const tokenHash = this.#hash(rawRefreshToken);
    const expiryDays = this.config.get('JWT_REFRESH_EXPIRY_DAYS');
    const expiresAt = new Date(Date.now() + expiryDays * MS_PER_DAY);

    await this.refreshTokenRepo.create({
      id: sessionId,
      employeeId: employee.id,
      tokenHash,
      familyId,
      authMethod,
      expiresAt,
    });

    const accessToken = await this.jwt.signAsync({
      // RFC 7519 standard claim — OWASP-recommended revocation key (jti + iss pair)
      jti: sessionId,
      sub: employee.id,
      email: employee.email,
      name: employee.displayName,
      roles: employee.roles,
      authMethod,
    });

    // Derive expiresIn from the actual JWT config so the frontend knows the real
    // token lifetime (e.g. 8h = 28800s) instead of a hardcoded 15-min constant.
    const expiresIn = AuthService.parseExpiryToSeconds(this.config.get('JWT_ACCESS_EXPIRY'));

    return { accessToken, expiresIn, rawRefreshToken };
  }

  #hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
