import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DevLoginSchema = z.object({
  email: z.string().email(),
});
export class DevLoginDto extends createZodDto(DevLoginSchema) {}

export const EntraLoginSchema = z.object({
  /** Entra ID id_token obtained from MSAL loginPopup / loginRedirect. */
  idToken: z.string().min(10),
});
export class EntraLoginDto extends createZodDto(EntraLoginSchema) {}

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
}
