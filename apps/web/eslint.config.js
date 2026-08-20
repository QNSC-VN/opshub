import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `coverage` is the v8 reporter's own HTML output — third-party scripts with their own stale
  // eslint directives, which surface as warnings and fail `--max-warnings 0` the moment somebody
  // runs the coverage script before the lint one.
  { ignores: ['dist', 'coverage', 'src/shared/api/generated'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    /*
     * PLAYWRIGHT FIXTURES ARE NOT REACT, and two rules here cannot tell the difference.
     *
     * A fixture's signature is `async ({}, use) => …`: the empty destructuring pattern declares "this
     * fixture depends on nothing", which `no-empty-pattern` reads as a mistake, and Playwright's `use`
     * callback trips `react-hooks/rules-of-hooks` because the name begins with "use". Both are correct
     * Playwright and neither is reachable from the app, so the rules are switched off for the e2e
     * directory rather than papered over with inline disables at every fixture.
     *
     * Scoped to `e2e/` alone: these rules are exactly the ones that matter in `src/`.
     */
    files: ['e2e/**/*.ts'],
    rules: {
      'no-empty-pattern': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
