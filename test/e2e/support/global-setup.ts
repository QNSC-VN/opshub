/**
 * ONE database reset for the whole e2e run: truncate the operational tables, then re-seed
 * the demo fixtures.
 *
 * Runs once before any spec file, not per file, so a suite that spans several files still
 * starts from one known state and files cannot be made to depend on each other's order.
 *
 * The re-seed happens AFTER the truncate and IN THIS PROCESS, so the first spec starts
 * against exactly the fixtures a developer sees locally — the same `pnpm db:seed` entry
 * point, so the suite and a local database cannot drift apart. `seed()` is imported lazily
 * because it opens its own pool and reads env at module load, which would run it even when
 * the reset is skipped.
 */
import { resetFixtureTables } from '../../../db/reset';

export default async function setup(): Promise<void> {
  // Deliberately opt-out-able: a developer bisecting one failing file may want the database
  // left exactly as it is. The default is to reset, because the default should be correct.
  if (process.env['E2E_SKIP_RESET'] === 'true') return;

  const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('E2E reset needs DATABASE_URL (or DATABASE_MIGRATION_URL).');

  await resetFixtureTables(url);

  const { seed } = await import('../../../db/seed');
  await seed(url);
}
