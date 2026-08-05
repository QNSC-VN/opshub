import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

// Load .env before this config — and the AppModule it boots — reads process.env. Node does
// not auto-load .env files, and nothing else in the e2e path did, so ConfigModule's Zod
// validation failed on any machine without these already exported in the shell.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI injects the vars directly */
}

// E2E config: runs the real AppModule against a real Postgres + Valkey.
// Specs live in test/e2e/**/*.e2e.spec.ts and boot through test/e2e/support/harness.ts.
//
// Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:seed`.
export default defineConfig({
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.spec.ts'],
    /**
     * NOT `passWithNoTests`. It was true while the directory was empty, which made the
     * `E2E tests` CI job report success having run nothing — the job existed, went green on
     * every PR, and tested exactly zero behaviour. A gate that cannot fail is worse than a
     * missing one, because it gets mistaken for coverage.
     *
     * Now that specs exist, an empty run means the glob broke or the files were not checked
     * out, and vitest exits non-zero saying so.
     */
    passWithNoTests: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    // Booting the real AppModule (Nest DI, Drizzle pool, Valkey) plus the fixture logins
    // runs well past the 30s default on a cold start.
    hookTimeout: 60_000,
    /**
     * Run spec FILES one at a time. These specs share ONE Postgres and ONE Valkey, and
     * vitest runs files in parallel workers by default — so two files can mutate
     * overlapping rows, and both draw from the same per-IP `AUTH_LOGIN` bucket during their
     * `beforeAll` logins. Both are cross-file interference, not real product flake. Serial
     * execution removes the class; tests within a file still run in order. Slower, but a
     * shared stateful backend cannot be driven in parallel without per-spec isolation,
     * which this suite does not have.
     *
     * Adopted from rally, where both failure modes were diagnosed the hard way.
     */
    fileParallelism: false,
  },
});
