import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Auth,
  ApiCommonErrors,
  CurrentUser,
  Public,
  UnauthorizedException,
  ErrorCodes,
  AppConfigService,
  AuthzService,
  RateLimit,
} from '@platform';
import type { JwtPayload } from '@platform';
import type { FastifyRequest, FastifyReply } from 'fastify';
import '@fastify/cookie';
import { AuthService } from '../../application/auth.service';
import { EntraLoginDto, AuthResponseDto, MeResponseDto } from './dto/auth.dto';

const REFRESH_COOKIE = 'refresh_token';

/** Path-scoped cookie options — ensures the refresh token is only sent to the auth path. */
function refreshCookieOptions(maxAge: number, isProd: boolean) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/v1/auth',
    maxAge,
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  readonly #isProd: boolean;
  readonly #refreshMaxAge: number;

  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
    private readonly authz: AuthzService,
  ) {
    this.#isProd = config.get('NODE_ENV') === 'production';
    this.#refreshMaxAge = config.get('JWT_REFRESH_EXPIRY_DAYS') * 24 * 60 * 60;
  }

  /** Brute-force / credential-stuffing protection: 5 attempts per 15 min per IP. */
  @Post('entra-login')
  @Public()
  @RateLimit('AUTH_LOGIN')
  @HttpCode(200)
  @ApiOperation({
    summary: 'SSO login — validate Entra ID id_token, JIT-provision employee, mint internal JWT',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiCommonErrors(401)
  async entraLogin(
    @Body() dto: EntraLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponseDto> {
    const { accessToken, expiresIn, rawRefreshToken } = await this.authService.entraLogin(
      dto.idToken,
    );
    reply.setCookie(
      REFRESH_COOKIE,
      rawRefreshToken,
      refreshCookieOptions(this.#refreshMaxAge, this.#isProd),
    );
    return { accessToken, expiresIn };
  }

  @Post('refresh')
  @Public()
  @RateLimit('AUTH_REFRESH')
  @HttpCode(200)
  @ApiOperation({ summary: 'Silently refresh the access token using the HttpOnly refresh cookie' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiCommonErrors(401)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponseDto> {
    const rawToken = request.cookies?.[REFRESH_COOKIE];
    if (!rawToken) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
      throw new UnauthorizedException(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'No refresh token');
    }
    const { accessToken, expiresIn, rawRefreshToken } = await this.authService.refresh(rawToken);
    reply.setCookie(
      REFRESH_COOKIE,
      rawRefreshToken,
      refreshCookieOptions(this.#refreshMaxAge, this.#isProd),
    );
    return { accessToken, expiresIn };
  }

  @Post('logout')
  @Auth()
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Revoke the current session — invalidates both the refresh token and the active access token',
  })
  @ApiNoContentResponse()
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const rawToken = request.cookies?.[REFRESH_COOKIE];
    if (rawToken) {
      // Pass access token exp so the revocation cache entry expires exactly when
      // the JWT would have anyway — no over- or under-blocking.
      await this.authService.logout(rawToken, user.exp);
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }

  @Get('me')
  @Auth()
  @ApiOperation({ summary: 'Return the authenticated principal and its effective permissions' })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiCommonErrors(401)
  async me(@CurrentUser() user: JwtPayload): Promise<MeResponseDto> {
    // Effective permissions come from the DB (the single source of truth the
    // PolicyGuard also enforces). The SPA gates its UI on this list rather than
    // re-deriving permissions from role names, so FE and BE can never drift.
    const effective = await this.authz.resolve(user.sub);
    return {
      sub: user.sub,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: Object.keys(effective),
    };
  }
}
