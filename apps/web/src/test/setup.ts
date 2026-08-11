/**
 * Test setup for the component specs.
 *
 * `@testing-library/jest-dom` for the matchers (`toBeInTheDocument`, `toBeDisabled`), and an
 * automatic `cleanup` between tests: React Testing Library only auto-cleans when a global
 * `afterEach` exists, and without it a second render in the same file finds two copies of every
 * element and `getByRole` throws on the ambiguity.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
