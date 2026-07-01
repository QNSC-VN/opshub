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
      JWT_SECRET: 'test-jwt-secret-minimum-32-characters-long-ok',
      JWT_ACCESS_EXPIRY: '8h',
      JWT_ISSUER: 'opshub-test',
      JWT_AUDIENCE: 'opshub-test-app',
      CORS_ORIGINS: 'http://localhost:5173',
      LOG_LEVEL: 'fatal',
      LOG_PRETTY: 'false',
      LOG_SQL: 'false',
      OTEL_ENABLED: 'false',
      OTEL_SERVICE_NAME: 'opshub-api-test',
    },
    include: ['libs/**/*.spec.ts', 'apps/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['libs/**/*.ts', 'apps/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.module.ts', '**/index.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});

