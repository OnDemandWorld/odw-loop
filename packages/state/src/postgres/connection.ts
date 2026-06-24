/**
 * PostgreSQL connection management with connection pooling.
 */

import { drizzle, type NodePostgresDriver } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createLogger } from '@loop/observability';
import * as schema from '../schema.js';

const logger = createLogger({ name: 'loop:state:postgres', component: 'state' });

export interface PostgresConnection {
  db: NodePostgresDriver<typeof schema>;
  pool: Pool;
  close(): Promise<void>;
}

export interface PostgresConnectionOptions {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  poolSize?: number;
}

export function createPostgresConnection(opts: PostgresConnectionOptions): PostgresConnection {
  const pool = new Pool({
    host: opts.host,
    port: opts.port,
    database: opts.database,
    user: opts.user,
    password: opts.password,
    ssl: opts.ssl ? { rejectUnauthorized: false } : false,
    max: opts.poolSize ?? 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    logger.error({ error: String(err) }, 'PostgreSQL pool error');
  });

  logger.info({ host: opts.host, port: opts.port, database: opts.database }, 'PostgreSQL connection pool created');

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
      logger.info('PostgreSQL connection pool closed');
    },
  };
}
