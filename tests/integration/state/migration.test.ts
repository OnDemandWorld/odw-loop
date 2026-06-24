/**
 * Integration tests — database migration pipeline.
 *
 * Runs the full migration pipeline against a fresh in-memory SQLite database
 * via `SqliteStateStore.initialise()` and verifies that every expected table
 * and index exists. Also checks that migrations are idempotent.
 */

import { describe, it, expect } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src/index.js';

const EXPECTED_TABLES = [
  'users',
  'workflows',
  'workflow_definitions',
  'workflow_executions',
  'node_executions',
  'workflow_triggers',
  'audit_events',
  'secrets',
  'egress_policies',
  'connectors',
  'schema_migrations',
];

const EXPECTED_INDEXES = [
  'idx_workflows_status_updated',
  'idx_workflows_created_by',
  'idx_wf_defs_workflow',
  'idx_exec_workflow_started',
  'idx_exec_status_started',
  'idx_exec_started',
  'idx_node_exec_execution',
  'idx_node_exec_node',
  'idx_audit_timestamp',
  'idx_audit_resource',
  'idx_audit_actor',
];

describe('Database migrations (integration)', () => {
  it('applies migrations to a fresh SQLite database and creates all tables', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    const tables = conn.client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames, `table '${expected}' should exist`).toContain(expected);
    }

    conn.close();
  });

  it('creates all expected indexes', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    const indexes = conn.client
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name IS NOT NULL`)
      .all() as Array<{ name: string }>;

    const indexNames = new Set(indexes.map((i) => i.name));
    for (const expected of EXPECTED_INDEXES) {
      expect(indexNames, `index '${expected}' should exist`).toContain(expected);
    }

    conn.close();
  });

  it('migrations are idempotent (re-running does not error or duplicate)', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.initialise();
    await store.initialise();

    const migrations = conn.client
      .prepare(`SELECT version, COUNT(*) as cnt FROM schema_migrations GROUP BY version`)
      .all() as Array<{ version: string; cnt: number }>;

    for (const row of migrations) {
      expect(row.cnt).toBe(1);
    }
    expect(migrations.length).toBeGreaterThan(0);

    conn.close();
  });

  it('records version and checksum for each applied migration', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    const rows = conn.client
      .prepare(`SELECT version, checksum, applied_at FROM schema_migrations`)
      .all() as Array<{ version: string; checksum: string; applied_at: string }>;

    for (const row of rows) {
      expect(row.version).toMatch(/^\d+$/);
      expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(row.applied_at).toBeTruthy();
    }

    conn.close();
  });

  it('tables have the expected column structure (workflows)', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    const columns = conn.client
      .prepare(`PRAGMA table_info(workflows)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;

    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'description',
        'definition',
        'version',
        'status',
        'tags',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
      ]),
    );

    conn.close();
  });

  it('foreign keys are enforced (insert with invalid FK fails)', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    // workflows.created_by references users(id); inserting without a user
    // should throw because foreign_keys = ON.
    expect(() =>
      conn.client
        .prepare(
          `INSERT INTO workflows (id, name, description, definition, version, status, tags, created_by, updated_by)
           VALUES ('x', 'n', '', '{}', 1, 'draft', '[]', 'nonexistent', 'nonexistent')`,
        )
        .run(),
    ).toThrow();

    conn.close();
  });

  it('state store can perform CRUD after migration', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    const store = new SqliteStateStore(conn);
    await store.initialise();

    // Seed a user (needed for workflow FK)
    await store.users.create({
      id: 'u-1',
      username: 'test',
      password_hash: 'x',
      email: 'test@loop.test',
      role: 'admin',
    });

    const wf = await store.workflows.create({
      id: 'w-1',
      name: 'Test Workflow',
      description: '',
      definition: {
        version: '1.0',
        nodes: [],
        edges: [],
        variables: {},
        metadata: {},
      },
      created_by: 'u-1',
    });

    expect(wf.id).toBe('w-1');
    expect(wf.status).toBe('draft');
    expect(wf.version).toBe(1);

    const fetched = await store.workflows.getById('w-1');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Test Workflow');

    conn.close();
  });
});
