/**
 * Migration runner — applies SQL migrations idempotently on startup.
 * Uses the schema_migrations table to track applied versions.
 */
import type { SqliteConnection } from './sqlite/connection.js';
import { type Migration } from './migrations/index.js';
/**
 * Run all pending migrations.
 * Each migration is applied inside a transaction and tracked in schema_migrations.
 */
export declare function runMigrations(conn: SqliteConnection): Promise<void>;
export type { Migration };
//# sourceMappingURL=migrate.d.ts.map