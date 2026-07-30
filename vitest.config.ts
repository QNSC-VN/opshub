import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // SWC must come first — emits decorator metadata that NestJS DI relies on
    swc.vite(),
    tsconfigPaths(),
  ],
  resolve: {
    // Prefer TypeScript source over compiled JS so stale build artefacts
    // living alongside .ts files don't shadow the real source.
    extensions: ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/opshub_test',
      // EC P-256 (ES256) test-only placeholder keys — must match algorithm: 'ES256' in platform.module.ts.
      JWT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQguroUP5ujCG9PaA7F\n+53M+ZEtNeuIunGs3mI6EEuD5qKhRANCAASZgAZjNEMAVYuVFiV1KfKFDRLVoJki\nokvGm4Kv+GReUvPaxoZPolxDcDmmdUfVHKrRxNbN7Kw8/x1o+2BibAO+\n-----END PRIVATE KEY-----',
      JWT_PUBLIC_KEY:
        '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmYAGYzRDAFWLlRYldSnyhQ0S1aCZ\nIqJLxpuCr/hkXlLz2saGT6JcQ3A5pnVH1Ryq0cTWzeysPP8daPtgYmwDvg==\n-----END PUBLIC KEY-----',
      JWT_ACCESS_EXPIRY: '8h',
      JWT_ISSUER: 'opshub-test',
      JWT_AUDIENCE: 'opshub-test-app',
      CORS_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'fatal',
      LOG_PRETTY: 'false',
      LOG_SQL: 'false',
      OTEL_ENABLED: 'false',
      OTEL_SERVICE_NAME: 'opshub-api-test',
      COOKIE_SECRET: 'test-cookie-secret-minimum-32-chars!!',
      CSRF_SECRET: 'test-csrf-secret-minimum-32-characters!',
    },
    // `test/*.spec.ts` (one level, not recursive) picks up the cross-cutting
    // contract specs — the permission catalogue and the FE↔BE permission contract —
    // which belong to no single lib. Deliberately NOT `test/**` so anything added
    // under test/e2e stays with the separate e2e config that boots a real DB.
    // `db/**` is included because db/ holds production code the app imports, not just
    // migrations — db/database-url.ts composes the connection string every process
    // uses. A spec that never runs is worse than no spec, since it reads as coverage.
    // `apps/api` and `apps/worker`, not `apps/**`: the web app has its own vitest project
    // (apps/web/vitest.config.ts) that `Web · CI` runs, so sweeping it here would execute
    // the same specs twice — once per pipeline — and make coverage numbers depend on which
    // one you read.
    include: [
      'libs/**/*.spec.ts',
      'apps/api/**/*.spec.ts',
      'apps/worker/**/*.spec.ts',
      'db/**/*.spec.ts',
      'test/*.spec.ts',
    ],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['libs/**/*.ts', 'apps/api/**/*.ts', 'apps/worker/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.module.ts', '**/index.ts'],
      // Coverage ratchet: floors set just below current coverage so CI stays
      // green while preventing regressions. Raise these as suites are added —
      // never lower them. (Current ~lines 16% / funcs 11% / branches 12% / stmts 16%.)
      thresholds: {
        lines: 15,
        functions: 10,
        branches: 10,
        statements: 15,
      },
    },
  },
});
