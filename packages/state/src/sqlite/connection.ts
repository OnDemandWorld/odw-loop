/**
 * SQLite connection management with WAL mode and safe defaults.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createLogger } from '@loop/observability';
import * as schema from '../schema.js';

const logger = createLogger({ name: 'loop:state:sqlite', component: 'state' });

export interface SqliteConnection {
  db: BetterSQLite3Database<typeof schema>;
  client: Database.Database;
  close(): void;
}

export interface SqliteConnectionOptions {
  /** File path or ':memory:'. */
  path: string;
  /** Enable WAL mode (recommended for concurrent reads). Default true. */
  wal?: boolean;
}

export function createSqliteConnection(opts: SqliteConnectionOptions): SqliteConnection {
  const client = new Database(opts.path);

  // Pragmas for performance and safety
  if (opts.wal !== false) {
    client.pragma('journal_mode = WAL');
  }
  client.pragma('busy_timeout = 5000');
  client.pragma('foreign_keys = ON');
  client.pragma('synchronous = NORMAL');

  logger.info({ path: opts.path, wal: opts.wal !== false }, 'SQLite connection opened');

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close() {
      client.close();
      logger.info('SQLite connection closed');
    },
  };
}
