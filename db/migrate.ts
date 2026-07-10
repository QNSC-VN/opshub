/**
 * DB migration runner — called by CI as a gated job BEFORE deploying a new app version.
 * Uses DATABASE_MIGRATION_URL (privileged role) when set; falls back to DATABASE_URL.
 * Never run by the app process itself.
 */
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — CI mode */
}

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';
import { seed, seedRbacCatalog } from './seed';
import { pgOptions } from './pg-ssl';

const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];

if (!url) {
  console.error('❌  DATABASE_MIGRATION_URL or DATABASE_URL required');
  process.exit(1);
}

const pool = new Pool({ ...pgOptions(url), max: 1 });
const db = drizzle(pool);

async function run() {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') });
    console.log('✅  Migrations applied');

    // Seed uses DATABASE_URL (app role), not the migration URL (admin role).
    const seedUrl = process.env['DATABASE_URL'] ?? url;

    // The RBAC reference catalogue (permissions + roles + grants) is prod-safe
    // reference data the app depends on to authorize anything — ensure it in
    // EVERY environment, independent of SEED_ON_DEPLOY.
    await seedRbacCatalog(seedUrl);
    console.log('✅  RBAC catalogue ensured');

    // In develop/staging, also seed demo fixtures (login-able employees) on
    // every deploy. Never set SEED_ON_DEPLOY=true in production.
    if (process.env['SEED_ON_DEPLOY'] === 'true') {
      console.log('SEED_ON_DEPLOY=true — seeding demo fixtures...');
      await seed(seedUrl);
    }
  } catch (err) {
    console.error('❌  Migration failed', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void run();
