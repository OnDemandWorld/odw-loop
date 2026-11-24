/**
 * Unit tests — SQLite JSON column encoding (audit #60).
 *
 * json-mode columns must be single-encoded: drizzle serializes once, callers
 * pass raw objects. Legacy double-encoded rows are repaired by migration 004.
 * Also pins the atomic version increment (audit #134).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { MIGRATIONS } from '../../../packages/state/src/migrations/index';
import type { WorkflowDefinition } from '../../../packages/types/src';

const DEF: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'enc', description: '', tags: [] },
};

describe('SQLite JSON encoding (audit #60, #134)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  async function setup(): Promise<{ conn: SqliteConnection; store: SqliteStateStore }> {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.users.create({ id: 'system', username: 'system', password_hash: '', email: 's@loop.test', role: 'admin' });
    return { conn, store };
  }

  it('writes single-encoded JSON (json_extract works directly in SQL)', async () => {
    const { conn, store } = await setup();
    await store.workflows.create({ id: 'wf-enc', name: 'enc', description: '', definition: DEF, created_by: 'system', tags: ['prod'] });
    const row = conn.client
      .prepare("SELECT json_type(definition) AS dt, json_extract(definition, '$.version') AS v, json_type(tags) AS tt FROM workflows WHERE id = 'wf-enc'")
      .get() as { dt: string; v: string; tt: string };
    expect(row.dt).toBe('object');
    expect(row.v).toBe('1.0');
    expect(row.tt).toBe('array');
    // App reads still round-trip.
    const wf = await store.workflows.getById('wf-enc');
    expect(wf?.definition.version).toBe('1.0');
    expect(wf?.tags).toEqual(['prod']);
  });

  it('migration 004 repairs legacy double-encoded rows', async () => {
    const { conn, store } = await setup();
    await store.workflows.create({ id: 'wf-old', name: 'old', description: '', definition: DEF, created_by: 'system', tags: ['prod'] });
    // Simulate the legacy double-encoded form.
    conn.client.exec("UPDATE workflows SET definition = json_quote(definition), tags = json_quote(tags) WHERE id = 'wf-old'");
    const before = conn.client.prepare("SELECT json_type(definition) AS dt FROM workflows WHERE id = 'wf-old'").get() as { dt: string };
    expect(before.dt).toBe('text');

    const m004 = MIGRATIONS.find((m) => m.version === '004');
    expect(m004).toBeDefined();
    conn.client.exec(m004!.sql);

    const after = conn.client.prepare("SELECT json_type(definition) AS dt, json_type(tags) AS tt FROM workflows WHERE id = 'wf-old'").get() as { dt: string; tt: string };
    expect(after.dt).toBe('object');
    expect(after.tt).toBe('array');
    const wf = await store.workflows.getById('wf-old');
    expect(wf?.definition.version).toBe('1.0');
    expect(wf?.tags).toEqual(['prod']);
  });

  it('version increments atomically on definition updates (audit #134)', async () => {
    const { store } = await setup();
    await store.workflows.create({ id: 'wf-ver', name: 'ver', description: '', definition: DEF, created_by: 'system' });
    await store.workflows.update('wf-ver', { definition: { ...DEF, version: '1.1' }, updated_by: 'system' });
    await store.workflows.update('wf-ver', { definition: { ...DEF, version: '1.2' }, updated_by: 'system' });
    const wf = await store.workflows.getById('wf-ver');
    expect(wf?.version).toBe(3);
  });
});
