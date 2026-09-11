/**
 * Migration runner — applies SQL migrations idempotently on startup.
 * Uses the schema_migrations table to track applied versions.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { SqliteConnection } from './sqlite/connection.js';
import * as schema from './schema.js';
import { MIGRATIONS, type Migration } from './migrations/index.js';

const logger = createLogger({ name: 'loop:state:migrate', component: 'state' });

/**
 * Run all pending migrations.
 * Each migration is applied inside a transaction and tracked in schema_migrations.
 */
export async function runMigrations(conn: SqliteConnection): Promise<void> {
  const { db, client } = conn;

  // Ensure the migrations tracking table exists (bootstrap)
  client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      checksum TEXT NOT NULL
    )
  `);

  const appliedRows = db.select().from(schema.schemaMigrations).all();
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) {
      logger.debug({ version: migration.version }, 'Migration already applied');
      continue;
    }

    const checksum = createHash('sha256').update(migration.sql).digest('hex');
    logger.info({ version: migration.version, checksum: checksum.slice(0, 12) }, 'Applying migration');

    // Apply the migration and its tracking row atomically. Without the
    // explicit transaction a mid-migration failure left the database
    // half-migrated and untracked, so the next startup replayed DDL that had
    // already run and crashed on "table already exists".
    client.exec('BEGIN');
    try {
      client.exec(migration.sql);
      db.insert(schema.schemaMigrations)
        .values({ version: migration.version, checksum })
        .run();
      client.exec('COMMIT');
    } catch (err) {
      client.exec('ROLLBACK');
      throw err;
    }
  }

  logger.info('All migrations applied');
}

export type { Migration };
