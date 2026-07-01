# OpsHub Web

Internal operations platform — frontend shell (Vite + React 19 + Tailwind 4 +
TanStack Router/Query + a typed `openapi-fetch` client).

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173 (proxies /v1 → API on :3000)
```

Start the API (`opshub-api`) first, then sign in via the dev-login screen.

## API types

The typed client in `src/shared/api/client.ts` is driven by the OpenAPI document
the API serves at `/api/docs-json`. Regenerate the types once the API is running:

```bash
pnpm codegen      # writes src/shared/api/generated/api.ts
```

## Structure (Feature-Sliced Design)

```
src/
  app/        providers, router, global styles
  pages/      route-level screens (login, dashboard, assets, …)
  widgets/    composite UI blocks (app shell)
  shared/     api client, ui primitives, lib helpers
```
