/**
 * Centralised environment configuration.
 * All `import.meta.env.*` access for the API origin should go through here.
 */
export const ENV = {
  // Empty string → relative URLs; works in dev (Vite proxy handles /v1). In prod
  // the SPA is served from Cloudflare Pages and the API lives on its own subdomain,
  // so VITE_API_URL points at the API origin (e.g. https://opshub-api-dev.qnsc.vn).
  API_BASE_URL: import.meta.env.VITE_API_URL ?? '',
} as const;
