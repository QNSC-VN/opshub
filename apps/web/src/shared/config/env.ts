/**
 * Centralised environment configuration.
 * All `import.meta.env.*` access for the API origin should go through here.
 */
export const ENV = {
  // Empty string → relative URLs, and that is the intended value in EVERY environment.
  // Locally the Vite proxy handles /v1; deployed, the SPA is served from Cloudflare
  // Pages and a Pages Function (apps/web/functions/v1/[[path]].ts) forwards /v1/* to the
  // API origin, so the browser only ever sees one origin.
  //
  // Do NOT point VITE_API_URL at the API host. Same-origin is a requirement, not a
  // preference: the BFF issues a `__Host-` session cookie, which cannot be set
  // cross-site, so talking to the API directly would break login while appearing to
  // work for unauthenticated requests.
  API_BASE_URL: import.meta.env.VITE_API_URL ?? '',
} as const;
