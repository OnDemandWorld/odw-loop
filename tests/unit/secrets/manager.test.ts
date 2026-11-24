/**
 * Unit tests — SecretsManager scoped uniqueness (audit #12).
 *
 * Every connector stores its key under the name 'api_key'; uniqueness must be
 * composite (name, scope, scope_id) so a second keyed connector can be created
 * without a UNIQUE(name) conflict, while same-scope duplicates still upsert.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { SecretsManager } from '../../../packages/secrets/src';

const KEY = 'test-master-key-with-sufficient-entropy-for-testing-purposes';

describe('SecretsManager — scoped uniqueness (audit #12)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  async function setup(): Promise<{ store: SqliteStateStore; manager: SecretsManager }> {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    return { store, manager: new SecretsManager(store, KEY) };
  }

  it('two connectors can each store an api_key secret', async () => {
    const { manager } = await setup();
    await manager.set({ name: 'api_key', value: 'key-A', scope: 'connector', scope_id: 'conn-a', created_by: 'api' });
    await manager.set({ name: 'api_key', value: 'key-B', scope: 'connector', scope_id: 'conn-b', created_by: 'api' });
    expect(await manager.get('api_key', 'connector', 'conn-a')).toBe('key-A');
    expect(await manager.get('api_key', 'connector', 'conn-b')).toBe('key-B');
  });

  it('same name+scope+scope_id upserts instead of conflicting', async () => {
    const { manager } = await setup();
    await manager.set({ name: 'api_key', value: 'old', scope: 'connector', scope_id: 'conn-a', created_by: 'api' });
    await manager.set({ name: 'api_key', value: 'new', scope: 'connector', scope_id: 'conn-a', created_by: 'api' });
    expect(await manager.get('api_key', 'connector', 'conn-a')).toBe('new');
  });

  it('global-scope duplicates upsert; distinct scopes coexist', async () => {
    const { manager } = await setup();
    await manager.set({ name: 'token', value: 'g1', scope: 'global', created_by: 'api' });
    await manager.set({ name: 'token', value: 'g2', scope: 'global', created_by: 'api' });
    await manager.set({ name: 'token', value: 'w1', scope: 'workflow', scope_id: 'wf-1', created_by: 'api' });
    expect(await manager.get('token', 'global')).toBe('g2');
    expect(await manager.get('token', 'workflow', 'wf-1')).toBe('w1');
  });
});

describe('SecretsManager — exact scope matching (audit #55)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('a scope-less lookup never matches another scope_id row', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    const manager = new SecretsManager(store, KEY);

    await manager.set({ name: 'api_key', value: 'key-A', scope: 'connector', scope_id: 'conn-a', created_by: 'api' });
    // No NULL-scope connector row exists yet — must NOT return conn-a's key.
    expect(await manager.get('api_key', 'connector')).toBeNull();

    await manager.set({ name: 'api_key', value: 'null-scope-value', scope: 'connector', created_by: 'api' });
    expect(await manager.get('api_key', 'connector')).toBe('null-scope-value');
    expect(await manager.get('api_key', 'connector', 'conn-a')).toBe('key-A');
  });
});
