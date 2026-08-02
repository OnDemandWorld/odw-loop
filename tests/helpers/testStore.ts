/**
 * V1.6 M1 (F-1, DB2): test store lifecycle helpers.
 *
 * better-sqlite3's native handle segfaults non-deterministically during
 * process teardown when it is reclaimed by GC instead of explicitly closed.
 * `withTestStore` guarantees the connection is closed when the test body
 * finishes (success OR failure), and a module-level registry lets the global
 * vitest setup (`tests/setup.ts`) mop up anything a test leaked.
 */

import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../packages/state/src/index.js';

export interface TestStore {
  conn: SqliteConnection;
  store: SqliteStateStore;
}

/** Connections handed out by the helpers below and not yet closed. */
const trackedConnections = new Set<SqliteConnection>();

/**
 * Create an initialised in-memory SQLite store, run `fn` with it, and
 * GUARANTEE the connection is closed afterwards — even when `fn` throws.
 * Prefer this over hand-rolled createStore/afterEach pairs in new tests.
 */
export async function withTestStore<T>(fn: (ctx: TestStore) => Promise<T>): Promise<T> {
  const conn = createSqliteConnection({ path: ':memory:', wal: false });
  trackedConnections.add(conn);
  const store = new SqliteStateStore(conn);
  try {
    await store.initialise();
    return await fn({ conn, store });
  } finally {
    trackedConnections.delete(conn);
    try {
      conn.close();
    } catch {
      // best-effort — the registry/exit hook (DB3) is the second line of defence.
    }
  }
}

/**
 * `withTestStore` variant that also seeds the `system` user most suites need
 * (workflow rows carry a `created_by` FK into users).
 */
export async function withSeededTestStore<T>(fn: (ctx: TestStore) => Promise<T>): Promise<T> {
  return withTestStore(async (ctx) => {
    await ctx.store.users.create({
      id: 'system',
      username: 'system',
      password_hash: '',
      email: 'system@loop.internal',
      role: 'admin',
      display_name: 'System',
    });
    return fn(ctx);
  });
}

/**
 * Register a connection created outside `withTestStore` for safety-net
 * teardown. Returns the connection unchanged for inline use:
 * `conn = trackConnection(createSqliteConnection({...}))`.
 */
export function trackConnection(conn: SqliteConnection): SqliteConnection {
  trackedConnections.add(conn);
  return conn;
}

/** Stop tracking a connection (e.g. after the test closed it explicitly). */
export function untrackConnection(conn: SqliteConnection): void {
  trackedConnections.delete(conn);
}

/**
 * Best-effort close of every still-tracked connection. Called by the global
 * vitest setup after each test as a safety net for leaked handles.
 */
export function closeTrackedConnections(): void {
  for (const conn of trackedConnections) {
    try {
      conn.close();
    } catch {
      // best-effort
    }
  }
  trackedConnections.clear();
}

/** Number of connections still tracked as open (diagnostics / tests). */
export function trackedConnectionCount(): number {
  return trackedConnections.size;
}
