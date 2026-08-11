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
 * `environment: 'node'` is still the DEFAULT, and deliberately: the CSRF policy, the session
 * fetch wrapper and the Pages Function proxy are pure modules exercised against the web-standard
 * `Request`/`Response`/`Headers` Node provides natively, and jsdom would be slower while
 * misrepresenting the Workers runtime the proxy actually runs in.
 *
 * The first component tests have now landed. They opt into jsdom with a per-file
 * `// @vitest-environment jsdom` pragma rather than a config glob, because Vitest 4 REMOVED
 * `environmentMatchGlobs` — a config written against it is silently ignored, which shows up as
 * `document is not defined` in a spec the config claims to have given a DOM. Switching the whole
 * project to jsdom would have been one line and the wrong one: it would run the Workers proxy specs
 * in a fake browser.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
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
        'src/shared/hooks/use-list-state.ts',
        'src/shared/ui/data-table.tsx',
        'src/shared/ui/pagination-footer.tsx',
        'functions/_lib/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', '**/*.test.ts'],
      // Measured at 100 statements / 98.73 branches / 100 functions / 100 lines across the six
      // files above. Floors sit just under, so a regression fails rather than merely dipping.
      // Raise, never lower.
      thresholds: {
        lines: 99,
        functions: 99,
        branches: 96,
        statements: 99,
      },
    },
  },
});
