import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './decorators';
import { CacheService } from '../cache/cache.service';
import { RequestContextService } from '../context/request-context';
import type { JwtPayload } from './jwt.strategy';

/**
 * JWT auth guard.
 * Verifies the Bearer access token, checks the revocation denylist in Redis,
 * then stamps request context so the logging interceptor and AuditService can
 * read the actor without explicit parameter threading.
 *
 * Pair with @Public() decorator to opt-out individual routes.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
    private readonly ctx: RequestContextService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    let result: boolean;
    try {
      result = await (super.canActivate(context) as Promise<boolean>);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error({ err }, 'JWT strategy error during canActivate');
      throw new UnauthorizedException('Authentication service unavailable');
    }
    if (!result) return false;

    const req = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    try {
      // Two fast-revocation checks (OWASP JWT Cheat Sheet, §No Built-In Token Revocation):
      //   1. Session-level  — explicit logout or rotation-theft detection
      //   2. Employee-level — offboarding revokes all outstanding access tokens
      const [sessionRevoked, employeeRevoked] = await Promise.all([
        this.cache.get(`revoked:session:${req.user.jti}`),
        this.cache.get(`revoked:employee:${req.user.sub}`),
      ]);
      if (sessionRevoked || employeeRevoked) {
        throw new UnauthorizedException('Session has been revoked');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Fail open — Redis unavailable should not block valid users.
      // Tokens still expire naturally via the JWT exp claim (max 15 min window).
      this.logger.warn({ err }, 'Token denylist check failed; failing open');
    }

    return true;
  }

  handleRequest<TUser extends JwtPayload>(err: Error | null, user: TUser | false): TUser {
    if (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error({ err }, 'Unexpected error in JWT handleRequest');
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (!user) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Stamp the per-request ALS context so the logging interceptor and
    // AuditService can read the actor without explicit parameter threading.
    const store = this.ctx.getStore();
    if (store) {
      store.userId = user.sub;
      store.userEmail = user.email;
    }

    return user;
  }
}
