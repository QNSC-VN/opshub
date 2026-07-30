import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tests for the web app.
 *
 * This config exists because `Web · CI`'s "Unit tests" job has always looked for
 * `apps/web/src/**\/*.spec.*` and then run `pnpm --filter opshub-web test:cov` — a script
 * that did not exist. The detector had simply never found a file, so the branch stayed
 * dormant and green. The first spec under `src/` turned it on and it failed immediately.
 *
 * `functions/**` is included here too, so the Pages Function proxy specs run in the WEB
 * pipeline where they belong. The root vitest config no longer sweeps `apps/web`, so every
 * spec runs exactly once rather than in both pipelines.
 *
 * `environment: 'node'`: nothing here renders a component. These are pure modules —
 * the CSRF policy, the session fetch wrapper, the proxy — exercised against the
 * web-standard `Request`/`Response`/`Headers` that Node provides natively. A jsdom
 * environment would be slower and would misrepresent the Workers runtime the proxy
 * actually runs in. Add jsdom (and a setup file) when the first component test lands.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'functions/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Scoped to the files that HAVE specs, so the number means something. The rest of
      // the SPA is UI that unit coverage would misrepresent — widen this as real specs
      // arrive, never to make a percentage look better.
      include: [
        'src/shared/api/csrf.ts',
        'src/shared/api/session-fetch.ts',
        'functions/_lib/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
      // Measured at 100/100/100/100 on those three files. Floors sit just under, so a
      // regression fails rather than merely dipping. Raise, never lower.
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 90,
        statements: 95,
      },
    },
  },
});
