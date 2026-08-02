/**
 * SQLite connection management with WAL mode and safe defaults.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createLogger } from '@loop/observability';
import * as schema from '../schema.js';

const logger = createLogger({ name: 'loop:state:sqlite', component: 'state' });

// ─── V1.6 M1 (F-1, DB3): connection registry + process-exit safety net ──────
//
// The rare high-load SIGSEGV that `scripts/run_with_retry.sh` papers over comes
// from better-sqlite3's native handle being torn down by GC during process
// exit instead of an explicit `db.close()`. Every connection opened here is
// registered, and a synchronous `process.on('exit')` handler releases any
// handles still open when the process terminates — best-effort, never throws.

const openClients = new Set<Database.Database>();
let exitHookInstalled = false;

function installProcessExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    closeAllSqliteConnections();
  });
}

/**
 * Best-effort close of every registered open connection (the same routine the
 * process `exit` hook runs). Idempotent; never throws.
 */
export function closeAllSqliteConnections(): void {
  for (const client of openClients) {
    try {
      client.close();
    } catch {
      // best-effort — a handle that refuses close at teardown is exactly the
      // situation this hook exists to tolerate.
    }
  }
  openClients.clear();
}

/** Number of connections currently registered as open (diagnostics / tests). */
export function openSqliteConnectionCount(): number {
  return openClients.size;
}

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
  openClients.add(client);
  installProcessExitHook();

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
      // Unregister first so the exit hook never double-closes an explicit close.
      // better-sqlite3's close() is itself idempotent.
      openClients.delete(client);
      client.close();
      logger.info('SQLite connection closed');
    },
  };
}
