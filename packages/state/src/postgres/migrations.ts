/**
 * PostgreSQL migration runner.
 * Applies the same SQL migrations as SQLite but with PostgreSQL-specific syntax adjustments.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { PostgresConnection } from './connection.js';
import { MIGRATIONS_PG, type Migration } from './migrations-pg.js';

const logger = createLogger({ name: 'loop:state:postgres:migrate', component: 'state' });

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

  const { rows: appliedRows } = await pool.query('SELECT version FROM schema_migrations');
  const appliedSet = new Set(appliedRows.map((r: { version: string }) => r.version));

  for (const migration of MIGRATIONS_PG) {
    if (appliedSet.has(migration.version)) {
      logger.debug({ version: migration.version }, 'Migration already applied');
      continue;
    }

    const checksum = createHash('sha256').update(migration.sql).digest('hex');
    logger.info({ version: migration.version, checksum: checksum.slice(0, 12) }, 'Applying migration');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [migration.version, checksum]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info('All PostgreSQL migrations applied');
}

export type { Migration };
