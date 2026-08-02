/**
 * V1.6 M1 (F-1, DB1–DB3): DB lifecycle unit tests.
 *
 *  - DB1: `StateStore.close()` releases the native better-sqlite3 handle and
 *    is idempotent.
 *  - DB2: the `withTestStore` helper guarantees close on success AND failure
 *    and leaves nothing tracked behind.
 *  - DB3: the connection registry tracks open handles and the process-exit
 *    routine (`closeAllSqliteConnections`) releases leaked ones best-effort.
 */

import { describe, it, expect } from 'vitest';

import {
  createSqliteConnection,
  SqliteStateStore,
  closeAllSqliteConnections,
  openSqliteConnectionCount,
  type SqliteConnection,
} from '../../../packages/state/src/index.js';
import { withTestStore, trackedConnectionCount } from '../../helpers/testStore.js';

async function seedUser(store: SqliteStateStore): Promise<void> {
  await store.users.create({
    id: 'system',
    username: 'system',
    password_hash: '',
    email: 'system@loop.internal',
    role: 'admin',
  });
}

describe('StateStore.close() — DB1', () => {
  it('releases the native handle — further queries fail', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await seedUser(store);
    expect(await store.users.list()).toHaveLength(1);

    await store.close();

    expect(conn.client.open).toBe(false);
    await expect(store.users.list()).rejects.toThrow();
  });

  it('close() is idempotent — a second close does not throw', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
  });
});

describe('withTestStore — DB2', () => {
  it('closes the store when fn succeeds', async () => {
    let captured: SqliteConnection | undefined;
    const count = await withTestStore(async ({ conn, store }) => {
      captured = conn;
      await seedUser(store);
      return (await store.users.list()).length;
    });

    expect(count).toBe(1);
    expect(captured?.client.open).toBe(false);
  });

  it('closes the store when fn throws', async () => {
    let captured: SqliteConnection | undefined;
    await expect(
      withTestStore(async ({ conn }) => {
        captured = conn;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(captured?.client.open).toBe(false);
  });

  it('leaves no tracked connections behind', async () => {
    await withTestStore(async () => undefined);
    expect(trackedConnectionCount()).toBe(0);
  });
});

describe('connection registry + exit fallback — DB3', () => {
  it('tracks open connections and unregisters on close', () => {
    const baseline = openSqliteConnectionCount();
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    expect(openSqliteConnectionCount()).toBe(baseline + 1);

    conn.close();
    expect(openSqliteConnectionCount()).toBe(baseline);
  });

  it('closeAllSqliteConnections() releases leaked handles (exit-hook routine)', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await seedUser(store);

    // Simulate the process-exit sweep over a "forgotten" connection.
    closeAllSqliteConnections();

    expect(openSqliteConnectionCount()).toBe(0);
    expect(conn.client.open).toBe(false);
    await expect(store.users.list()).rejects.toThrow();
  });

  it('closeAllSqliteConnections() is safe when nothing is open', () => {
    closeAllSqliteConnections();
    expect(() => closeAllSqliteConnections()).not.toThrow();
    expect(openSqliteConnectionCount()).toBe(0);
  });
});
