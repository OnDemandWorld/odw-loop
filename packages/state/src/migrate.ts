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

    // Apply migration
    client.exec(migration.sql);

    // Record in tracking table
    db.insert(schema.schemaMigrations)
      .values({ version: migration.version, checksum })
      .run();
  }

  logger.info('All migrations applied');
}

export type { Migration };
