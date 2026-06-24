/**
 * SQLite connection management with WAL mode and safe defaults.
 */
import Database from 'better-sqlite3';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../schema.js';
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
export declare function createSqliteConnection(opts: SqliteConnectionOptions): SqliteConnection;
//# sourceMappingURL=connection.d.ts.map