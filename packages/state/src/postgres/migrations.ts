/**
 * PostgreSQL migration runner.
 * Applies the same SQL migrations as SQLite but with PostgreSQL-specific syntax adjustments.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { PostgresConnection } from './connection.js';
import { MIGRATIONS_PG, type Migration } from './migrations-pg.js';

const logger = createLogger({ name: 'loop:state:postgres:migrate', component: 'state' });

/** Fixed key for the migration advisory lock (arbitrary, app-specific). */
const MIGRATION_LOCK_ID = 727001;

export async function runPostgresMigrations(conn: PostgresConnection): Promise<void> {
  const { pool } = conn;

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL
    )
  `);

  // Audit #59: serialize concurrent runners (e.g. Scale replicas booting in a
  // rolling deploy) with a session-level advisory lock, and re-read the
  // applied versions INSIDE the lock — the previous check-then-act raced on
  // concurrent DDL and the schema_migrations PK.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    const { rows: appliedRows } = await client.query('SELECT version, checksum FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map((r: { version: string }) => r.version));
    const appliedChecksums = new Map(appliedRows.map((r: { version: string; checksum: string }) => [r.version, r.checksum]));

    for (const migration of MIGRATIONS_PG) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      if (appliedSet.has(migration.version)) {
        // Audit #132: verify the stored checksum catches edited migrations.
        if (appliedChecksums.get(migration.version) !== checksum) {
          throw new Error(
            `Migration ${migration.version} checksum mismatch: the applied migration's SQL was edited. Restore the original SQL or add a new migration.`,
          );
        }
        logger.debug({ version: migration.version }, 'Migration already applied');
        continue;
      }

      logger.info({ version: migration.version, checksum: checksum.slice(0, 12) }, 'Applying migration');

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migration.version, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }

  logger.info('All PostgreSQL migrations applied');
}

export type { Migration };
