/**
 * Standalone migration runner — applies pending Drizzle migrations then exits.
 * Used by the CI/CD run-db-migration step and locally via `pnpm db:migrate`.
 * Loads .env via Node's native --env-file flag (see package.json script).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  // Drizzle migration owns the full DDL lifecycle (CREATE SCHEMA, CREATE TYPE,
  // CREATE TABLE, indexes, FKs). Do NOT pre-create schemas here — that would
  // cause the migration to fail with "schema already exists".
  await migrate(db, { migrationsFolder: './db/migrations' });
   
  console.log('✅ Migrations applied');
  await pool.end();
}

main().catch((err) => {
   
  console.error('❌ Migration failed', err);
  process.exit(1);
});
