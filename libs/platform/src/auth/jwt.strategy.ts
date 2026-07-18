import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload as SharedJwtPayload } from '@qnsc-vn/identity';
import { AppConfigService } from '../config/app-config.service';

/**
 * Authenticated principal attached to request.user after JWT validation.
 *
 * The access token is minted by the shared `@qnsc-vn/identity` AuthService, so
 * it carries the package's payload shape (`sessionId`, `contextId`, and a nested
 * `claims` bag). OpsHub is single-tenant — roles drive RBAC (e.g. 'it-admin',
 * 'hr', 'security') — so the strategy flattens `claims.roles/email/name` onto
 * the principal for the guards, controllers, and audit context. `sessionId` and
 * `jti` are threaded through so logout can revoke both the session row and the
 * access-token denylist entry.
 */
export interface JwtPayload extends SharedJwtPayload {
  email: string;
  name: string;
  roles: string[];
}

/** The nested authorization claims opshub's {@link RolesClaimsProvider} stamps. */
interface OpshubClaims {
  roles?: string[];
  email?: string;
  name?: string;
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

  validate(payload: SharedJwtPayload): JwtPayload {
    // Signature, exp, iss, aud already verified by passport-jwt.
    // Denylist check (revocation) is handled in JwtAuthGuard.canActivate().
    // Flatten the package's nested `claims` onto the principal so the RoleGuard,
    // AuthzService, and audit context read `roles`/`email`/`name` directly.
    const claims = (payload.claims ?? {}) as OpshubClaims;
    return {
      ...payload,
      roles: claims.roles ?? [],
      email: claims.email ?? '',
      name: claims.name ?? '',
    };
  }
}
