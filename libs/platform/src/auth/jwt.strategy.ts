import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../config/app-config.service';

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
  /** How the session was established — always 'sso' (Entra ID OIDC). */
  authMethod: 'sso';
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['ES256'],
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    // Signature, exp, iss, aud already verified by passport-jwt.
    // Denylist check (revocation) is handled in JwtAuthGuard.canActivate().
    return payload;
  }
}
