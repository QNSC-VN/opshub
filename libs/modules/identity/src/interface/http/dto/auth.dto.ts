import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EntraLoginSchema = z.object({
  /** Entra ID id_token obtained from MSAL loginPopup / loginRedirect. */
  idToken: z.string().min(10),
});
export class EntraLoginDto extends createZodDto(EntraLoginSchema) {}

export const DevLoginSchema = z.object({
  /** Email of an existing active employee. Non-production only. */
  email: z.string().email(),
});
export class DevLoginDto extends createZodDto(DevLoginSchema) {}

export const BffLoginSchema = z.object({
  /**
   * Same-origin path to land on after login. Validated server-side by the shared
   * service's open-redirect guard, which falls back to BFF_POST_LOGIN_REDIRECT — so an
   * absolute URL here cannot bounce the browser off-site.
   */
  returnTo: z.string().optional(),
});
export class BffLoginDto extends createZodDto(BffLoginSchema) {}

/**
 * Response for all auth login + refresh endpoints.
 * The refresh token is delivered via HttpOnly cookie — never in the response body.
 */
export class AuthResponseDto {
  /** Short-lived access JWT. Store in memory only — never localStorage. */
  accessToken!: string;
  /** Seconds until the access token expires. */
  expiresIn!: number;
}

export class MeResponseDto {
  sub!: string;
  email!: string;
  name!: string;
  roles!: string[];
  /**
   * Effective permission keys resolved from the user's role assignments (DB).
   * `'*'` means super-admin (all permissions). This is the single source of
   * truth the SPA uses to gate UI — it must never re-derive permissions itself.
   */
  permissions!: string[];
  /**
   * Double-submit CSRF token, bound by HMAC to the session that requested it.
   *
   * Present ONLY for a request authenticated by the BFF session cookie — a Bearer
   * caller is not exposed to CSRF and is not issued one. The SPA echoes it in the
   * `X-CSRF-Token` header on every state-changing request.
   */
  csrfToken?: string;
}
