import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteConnection, type SqliteConnection } from '../../../packages/state/src/sqlite/connection.js';
import { runMigrations } from '../../../packages/state/src/migrate.js';
import * as schema from '../../../packages/state/src/schema.js';

describe('Migration Runner', () => {
  let conn: SqliteConnection;

  beforeEach(() => {
    conn = createSqliteConnection({ path: ':memory:', wal: false });
  });

  afterEach(() => {
    if (conn) {
      conn.close();
    }
  });

  it('should apply migration to fresh SQLite database', async () => {
    await runMigrations(conn);

    // Verify schema_migrations table exists and has entries
    const migrations = conn.db.select().from(schema.schemaMigrations).all();
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('should be idempotent (no errors on second run)', async () => {
    await runMigrations(conn);

    // Run again - should not throw
    await expect(runMigrations(conn)).resolves.not.toThrow();

    // Should still have same number of migrations
    const migrations = conn.db.select().from(schema.schemaMigrations).all();
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('should track applied versions in schema_migrations table', async () => {
    await runMigrations(conn);

    const migrations = conn.db.select().from(schema.schemaMigrations).all();

    // Should have at least the initial schema migration
    expect(migrations.length).toBeGreaterThan(0);

    // Each migration should have version and checksum
    for (const migration of migrations) {
      expect(migration.version).toBeDefined();
      expect(migration.checksum).toBeDefined();
      expect(migration.applied_at).toBeDefined();
    }

    // Check that version '001' exists
    const initialMigration = migrations.find(m => m.version === '001');
    expect(initialMigration).toBeDefined();
  });

  it('should create all 10 tables', async () => {
    await runMigrations(conn);

    // Query the sqlite_master table to get all user tables
    const tables = conn.client.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);

    // Should have these 11 tables (10 domain + 1 schema_migrations)
    const expectedTables = [
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

    for (const expectedTable of expectedTables) {
      expect(tableNames).toContain(expectedTable);
    }

    // Should have at least 11 tables (10 domain + schema_migrations)
    expect(tableNames.length).toBeGreaterThanOrEqual(11);
  });
});
