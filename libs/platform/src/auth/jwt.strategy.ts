import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../config/app-config.service';
import { CacheService } from '../cache/cache.service';
import { requestContextStorage } from '../context/request-context';
import { UnauthorizedException } from '../errors/exceptions';
import { ErrorCodes } from '../errors/error-codes';

/**
 * Authenticated principal attached to request.user after JWT validation.
 *
 * `jti` is the RFC 7519 standard claim used as the revocation key (session ID).
 * OpsHub is single-tenant — roles drive RBAC (e.g. 'it-admin', 'hr', 'security').
 */
export interface JwtPayload {
  /** RFC 7519 JWT ID — unique session identifier, equals the refresh_tokens row id. */
  jti: string;
  /** Subject = employeeId */
  sub: string;
  email: string;
  name: string;
  roles: string[];
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly cache: CacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['ES256'],
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
    });
  }

  /**
   * Called on every authenticated request after the JWT signature and standard
   * claims (exp, iss, aud) have been verified by passport-jwt.
   *
   * Two fast-revocation checks (OWASP JWT Cheat Sheet, §No Built-In Token Revocation):
   *   1. Session-level  — explicit logout or rotation-theft detection
   *   2. Employee-level — offboarding revokes all outstanding access tokens
   *
   * Falls back silently when Redis is unavailable (access tokens still expire
   * naturally within 15 min).
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (this.cache.isAvailable) {
      const [sessionRevoked, employeeRevoked] = await Promise.all([
        // OWASP recommends keying the denylist on the `jti` claim (RFC 7519)
        this.cache.get(`revoked:session:${payload.jti}`),
        this.cache.get(`revoked:employee:${payload.sub}`),
      ]);
      if (sessionRevoked || employeeRevoked) {
        throw new UnauthorizedException(ErrorCodes.AUTH_TOKEN_INVALID, 'Session has been revoked');
      }
    }

    // Stamp the per-request ALS context so the logging interceptor and
    // AuditService can read the actor without explicit parameter threading.
    const store = requestContextStorage.getStore();
    if (store) {
      store.userId = payload.sub;
      store.userEmail = payload.email;
    }

    return payload;
  }
}
