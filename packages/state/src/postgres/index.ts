/**
 * PostgreSQL implementation of the StateStore interface (Scale tier).
 * Mirrors the SQLite implementation but uses PostgreSQL-specific features (JSONB, GIN indexes).
 */

import { createLogger } from '@loop/observability';
import type { WorkflowDefinition } from '@loop/types';
import type {
  StateStore,
  PaginationParams,
  WorkflowFilter,
  ExecutionFilter,
} from '../interface.js';
import { runPostgresMigrations } from './migrations.js';
import type { PostgresConnection } from './connection.js';

const logger = createLogger({ name: 'loop:state:postgres', component: 'state' });

function safeJsonParse(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

/**
 * Normalise a PostgreSQL TIMESTAMP value to an ISO-8601 string. node-postgres
 * returns TIMESTAMP columns as `Date` objects by default, but a mock client (or
 * a driver configured to return strings) may hand back a string — both are
 * accepted so the adapter mirrors the SQLite semantics (ISO strings) regardless.
 */
function toIsoString(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

/** Nullable variant of {@link toIsoString} for optional timestamp columns. */
function toNullableIsoString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

// ─── Row mappers (mirror the SQLite adapters' output shapes) ──────────────────

function mapWorkflowDefinition(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    workflow_id: row.workflow_id as string,
    version: row.version as number,
    definition: safeJsonParse(row.definition) as unknown as WorkflowDefinition,
    commit_hash: row.commit_hash as string,
    created_by: row.created_by as string,
    created_at: toIsoString(row.created_at),
    change_summary: (row.change_summary as string | null) ?? '',
  };
}

function mapExecution(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    workflow_id: row.workflow_id as string,
    workflow_version: row.workflow_version as number,
    trigger_type: row.trigger_type as 'manual' | 'cron' | 'webhook' | 'event',
    trigger_payload: safeJsonParse(row.trigger_payload),
    status: row.status as 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused',
    started_at: toNullableIsoString(row.started_at),
    completed_at: toNullableIsoString(row.completed_at),
    duration_ms: (row.duration_ms as number | null) ?? null,
    error: (row.error as string | null) ?? null,
    initiated_by: (row.initiated_by as string | null) ?? null,
  };
}

function mapNodeExecution(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    execution_id: row.execution_id as string,
    node_id: row.node_id as string,
    node_type: row.node_type as string,
    status: row.status as 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped',
    input: safeJsonParse(row.input),
    output: safeJsonParse(row.output),
    error: (row.error as string | null) ?? null,
    started_at: toNullableIsoString(row.started_at),
    completed_at: toNullableIsoString(row.completed_at),
    retry_count: (row.retry_count as number | null) ?? 0,
    metadata: safeJsonParse(row.metadata),
    idempotency_key: (row.idempotency_key as string | null) ?? null,
  };
}

function mapTrigger(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    workflow_id: row.workflow_id as string,
    trigger_type: row.trigger_type as 'cron' | 'webhook' | 'event' | 'manual',
    config: safeJsonParse(row.config),
    enabled: row.enabled as boolean,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

function mapConnector(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    connector_type: row.connector_type as 'vault' | 'desk' | 'recap' | 'generic',
    name: row.name as string,
    config: safeJsonParse(row.config),
    status: row.status as 'connected' | 'disconnected' | 'error',
    last_health_check: toNullableIsoString(row.last_health_check),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export class PostgresStateStore implements StateStore {
  private conn: PostgresConnection;

  constructor(conn: PostgresConnection) {
    this.conn = conn;
  }

  async initialise(): Promise<void> {
    await runPostgresMigrations(this.conn);
    logger.info('State store initialised (PostgreSQL)');
  }

  async close(): Promise<void> {
    await this.conn.close();
  }

  private get db() { return this.conn.db; }

  // PostgreSQL implementation mirrors SQLite but uses PostgreSQL-specific queries.
  // Due to the identical interface, the CRUD operations are structurally the same.
  // The main differences are:
  // - JSONB columns (native JSON support with indexing)
  // - GIN indexes for full-text search
  // - Connection pooling
  // - BYTEA for encrypted values

  workflows = {
    create: async (data: { id: string; name: string; description: string; definition: WorkflowDefinition; created_by: string; tags?: string[] }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO workflows (id, name, description, definition, version, status, tags, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, 'draft', $5, $6, $6, $7, $7)`,
        [data.id, data.name, data.description, JSON.stringify(data.definition), JSON.stringify(data.tags ?? []), data.created_by, now],
      );
      const result = await this.conn.pool.query('SELECT * FROM workflows WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create workflow');
      const row = result.rows[0] as Record<string, unknown>;
      return { id: row.id as string, name: row.name as string, description: row.description as string, definition: safeJsonParse(row.definition) as unknown as WorkflowDefinition, version: row.version as number, status: row.status as 'draft' | 'active' | 'archived', tags: safeJsonParse(row.tags) as unknown as string[], created_by: row.created_by as string, updated_by: row.updated_by as string, created_at: row.created_at as string, updated_at: row.updated_at as string };
    },

    getById: async (id: string) => {
      const result = await this.conn.pool.query('SELECT * FROM workflows WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as Record<string, unknown>;
      return { id: row.id as string, name: row.name as string, description: row.description as string, definition: safeJsonParse(row.definition) as unknown as WorkflowDefinition, version: row.version as number, status: row.status as 'draft' | 'active' | 'archived', tags: safeJsonParse(row.tags) as unknown as string[], created_by: row.created_by as string, updated_by: row.updated_by as string, created_at: row.created_at as string, updated_at: row.updated_at as string };
    },

    list: async (filter: WorkflowFilter, pagination: PaginationParams) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      if (filter.status) { conditions.push(`status = $${paramIdx}`); params.push(filter.status); paramIdx++; }
      if (filter.tag) { conditions.push(`tags @> $${paramIdx}`); params.push(JSON.stringify([filter.tag])); paramIdx++; }
      if (filter.search) { conditions.push(`to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', $${paramIdx})`); params.push(filter.search); paramIdx++; }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await this.conn.pool.query(`SELECT count(*)::int AS count FROM workflows ${whereClause}`, params);
      const total = (countResult.rows[0] as { count: number }).count ?? 0;
      const [sortField, sortDir] = (filter.sort ?? 'updated_at:desc').split(':');
      const sortCol = sortField === 'created_at' ? 'created_at' : 'updated_at';
      const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';
      const offset = (pagination.page - 1) * pagination.per_page;
      const dataResult = await this.conn.pool.query(
        `SELECT * FROM workflows ${whereClause} ORDER BY ${sortCol} ${orderDir} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, pagination.per_page, offset],
      );
      const data = dataResult.rows.map((r: Record<string, unknown>) => ({ id: r.id as string, name: r.name as string, description: r.description as string, definition: safeJsonParse(r.definition) as unknown as WorkflowDefinition, version: r.version as number, status: r.status as 'draft' | 'active' | 'archived', tags: safeJsonParse(r.tags) as unknown as string[], created_by: r.created_by as string, updated_by: r.updated_by as string, created_at: r.created_at as string, updated_at: r.updated_at as string }));
      return { data, total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page) };
    },

    update: async (id: string, data: { name?: string; description?: string; definition?: WorkflowDefinition; status?: 'draft' | 'active' | 'archived'; tags?: string[]; updated_by: string }) => {
      const now = new Date().toISOString();
      const setClauses: string[] = ['updated_at = $2', 'updated_by = $3'];
      const params: unknown[] = [id, now, data.updated_by];
      let paramIdx = 4;
      if (data.name !== undefined) { setClauses.push(`name = $${paramIdx}`); params.push(data.name); paramIdx++; }
      if (data.description !== undefined) { setClauses.push(`description = $${paramIdx}`); params.push(data.description); paramIdx++; }
      if (data.definition !== undefined) {
        setClauses.push(`definition = $${paramIdx}`); params.push(JSON.stringify(data.definition)); paramIdx++;
        setClauses.push('version = version + 1');
      }
      if (data.status !== undefined) { setClauses.push(`status = $${paramIdx}`); params.push(data.status); paramIdx++; }
      if (data.tags !== undefined) { setClauses.push(`tags = $${paramIdx}`); params.push(JSON.stringify(data.tags)); paramIdx++; }
      await this.conn.pool.query(`UPDATE workflows SET ${setClauses.join(', ')} WHERE id = $1`, params);
      return (await this.workflows.getById(id))!;
    },

    archive: async (id: string) => {
      await this.conn.pool.query("UPDATE workflows SET status = 'archived' WHERE id = $1", [id]);
    },

    delete: async (id: string) => {
      await this.conn.pool.query('DELETE FROM node_executions WHERE execution_id = $1', [id]);
      await this.conn.pool.query('DELETE FROM workflow_executions WHERE workflow_id = $1', [id]);
      await this.conn.pool.query('DELETE FROM workflow_definitions WHERE workflow_id = $1', [id]);
      await this.conn.pool.query('DELETE FROM workflow_triggers WHERE workflow_id = $1', [id]);
      await this.conn.pool.query('DELETE FROM workflows WHERE id = $1', [id]);
    },
  };

  // V1.5 M1 (F-1): the remaining entities are fully implemented below with
  // parameterized ($1...) SQL, mirroring the SQLite adapter's semantics so the
  // PostgreSQL Scale layer reaches parity with the SQLite reference store.

  // ── Workflow Definitions (version snapshots) ──────────────────────────────

  workflowDefinitions = {
    create: async (data: {
      id: string; workflow_id: string; version: number; definition: WorkflowDefinition;
      commit_hash: string; created_by: string; change_summary?: string;
    }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO workflow_definitions (id, workflow_id, version, definition, commit_hash, created_by, created_at, change_summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.id, data.workflow_id, data.version, JSON.stringify(data.definition), data.commit_hash, data.created_by, now, data.change_summary ?? ''],
      );
      const result = await this.conn.pool.query('SELECT * FROM workflow_definitions WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create workflow definition');
      return mapWorkflowDefinition(result.rows[0] as Record<string, unknown>);
    },

    listByWorkflow: async (workflowId: string) => {
      const result = await this.conn.pool.query(
        'SELECT * FROM workflow_definitions WHERE workflow_id = $1 ORDER BY version DESC',
        [workflowId],
      );
      return result.rows.map((r: Record<string, unknown>) => mapWorkflowDefinition(r));
    },

    getByWorkflowAndVersion: async (workflowId: string, version: number) => {
      const result = await this.conn.pool.query(
        'SELECT * FROM workflow_definitions WHERE workflow_id = $1 AND version = $2',
        [workflowId, version],
      );
      if (result.rows.length === 0) return null;
      return mapWorkflowDefinition(result.rows[0] as Record<string, unknown>);
    },
  };

  // ── Executions ────────────────────────────────────────────────────────────

  executions = {
    create: async (data: {
      id: string; workflow_id: string; workflow_version: number;
      trigger_type: 'manual' | 'cron' | 'webhook' | 'event';
      trigger_payload?: Record<string, unknown>; initiated_by?: string;
    }) => {
      await this.conn.pool.query(
        `INSERT INTO workflow_executions (id, workflow_id, workflow_version, trigger_type, trigger_payload, status, initiated_by)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
        [data.id, data.workflow_id, data.workflow_version, data.trigger_type, JSON.stringify(data.trigger_payload ?? {}), data.initiated_by ?? null],
      );
      const result = await this.conn.pool.query('SELECT * FROM workflow_executions WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create execution');
      return mapExecution(result.rows[0] as Record<string, unknown>);
    },

    getById: async (id: string) => {
      const result = await this.conn.pool.query('SELECT * FROM workflow_executions WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      return mapExecution(result.rows[0] as Record<string, unknown>);
    },

    list: async (filter: ExecutionFilter, pagination: PaginationParams) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      if (filter.workflow_id) { conditions.push(`workflow_id = $${paramIdx}`); params.push(filter.workflow_id); paramIdx++; }
      if (filter.status) { conditions.push(`status = $${paramIdx}`); params.push(filter.status); paramIdx++; }
      if (filter.trigger_type) { conditions.push(`trigger_type = $${paramIdx}`); params.push(filter.trigger_type); paramIdx++; }
      if (filter.started_after) { conditions.push(`started_at >= $${paramIdx}`); params.push(filter.started_after); paramIdx++; }
      if (filter.started_before) { conditions.push(`started_at <= $${paramIdx}`); params.push(filter.started_before); paramIdx++; }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await this.conn.pool.query(`SELECT count(*)::int AS count FROM workflow_executions ${whereClause}`, params);
      const total = (countResult.rows[0] as { count: number }).count ?? 0;
      const offset = (pagination.page - 1) * pagination.per_page;
      const dataResult = await this.conn.pool.query(
        `SELECT * FROM workflow_executions ${whereClause} ORDER BY started_at DESC NULLS LAST LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, pagination.per_page, offset],
      );
      const data = dataResult.rows.map((r: Record<string, unknown>) => mapExecution(r));
      return { data, total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page) };
    },

    updateStatus: async (id: string, data: {
      status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';
      started_at?: string; completed_at?: string; duration_ms?: number; error?: string;
    }) => {
      await this.conn.pool.query(
        `UPDATE workflow_executions SET status = $2, started_at = $3, completed_at = $4, duration_ms = $5, error = $6 WHERE id = $1`,
        [id, data.status, data.started_at ?? null, data.completed_at ?? null, data.duration_ms ?? null, data.error ?? null],
      );
    },

    findInterrupted: async () => {
      // 'running' (died mid-execution) AND 'pending' (created but never
      // dispatched — e.g. crash between record creation and executor pickup).
      // Excluding 'pending' leaves those executions stuck forever (bug 12).
      const result = await this.conn.pool.query("SELECT * FROM workflow_executions WHERE status IN ('running', 'pending')");
      return result.rows.map((r: Record<string, unknown>) => mapExecution(r));
    },
  };

  // ── Node Executions ───────────────────────────────────────────────────────

  nodeExecutions = {
    create: async (data: {
      id: string; execution_id: string; node_id: string; node_type: string;
      input?: Record<string, unknown>; idempotency_key?: string;
    }) => {
      await this.conn.pool.query(
        `INSERT INTO node_executions (id, execution_id, node_id, node_type, status, input, idempotency_key)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
        [data.id, data.execution_id, data.node_id, data.node_type, JSON.stringify(data.input ?? {}), data.idempotency_key ?? null],
      );
      const result = await this.conn.pool.query('SELECT * FROM node_executions WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create node execution');
      return mapNodeExecution(result.rows[0] as Record<string, unknown>);
    },

    listByExecution: async (executionId: string) => {
      const result = await this.conn.pool.query(
        'SELECT * FROM node_executions WHERE execution_id = $1 ORDER BY started_at ASC NULLS FIRST',
        [executionId],
      );
      return result.rows.map((r: Record<string, unknown>) => mapNodeExecution(r));
    },

    findByIdempotencyKey: async (key: string) => {
      const result = await this.conn.pool.query('SELECT * FROM node_executions WHERE idempotency_key = $1', [key]);
      if (result.rows.length === 0) return null;
      return mapNodeExecution(result.rows[0] as Record<string, unknown>);
    },

    updateStatus: async (id: string, data: {
      status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
      started_at?: string; completed_at?: string; output?: Record<string, unknown>;
      error?: string; retry_count?: number; metadata?: Record<string, unknown>;
    }) => {
      // Mirror the SQLite semantics: status/started_at/completed_at/error are
      // always written (null when absent); output/retry_count/metadata are only
      // overwritten when explicitly supplied so existing values are preserved.
      const setClauses: string[] = ['status = $2', 'started_at = $3', 'completed_at = $4', 'error = $5'];
      const params: unknown[] = [id, data.status, data.started_at ?? null, data.completed_at ?? null, data.error ?? null];
      let paramIdx = 6;
      if (data.output !== undefined) { setClauses.push(`output = $${paramIdx}`); params.push(JSON.stringify(data.output)); paramIdx++; }
      if (data.retry_count !== undefined) { setClauses.push(`retry_count = $${paramIdx}`); params.push(data.retry_count); paramIdx++; }
      if (data.metadata !== undefined) { setClauses.push(`metadata = $${paramIdx}`); params.push(JSON.stringify(data.metadata)); paramIdx++; }
      await this.conn.pool.query(`UPDATE node_executions SET ${setClauses.join(', ')} WHERE id = $1`, params);
    },
  };

  // ── Execution Events (V1.1 M1) — fully implemented (used by recovery/executor) ──
  // These must not throw 'not implemented': the engine calls append() on every
  // lifecycle transition, so a throwing stub would break execution on PG.
  events = {
    append: async (data: {
      id: string; execution_id: string;
      event_type: 'execution_started' | 'node_started' | 'node_succeeded' | 'node_failed'
        | 'node_skipped' | 'execution_succeeded' | 'execution_failed' | 'execution_recovered';
      node_id?: string; payload?: Record<string, unknown>; created_at?: number;
    }) => {
      await this.conn.pool.query(
        `INSERT INTO execution_events (id, execution_id, event_type, node_id, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [data.id, data.execution_id, data.event_type, data.node_id ?? null, JSON.stringify(data.payload ?? {}), data.created_at ?? Date.now()],
      );
    },
    listByExecution: async (executionId: string) => {
      const result = await this.conn.pool.query(
        'SELECT * FROM execution_events WHERE execution_id = $1 ORDER BY created_at ASC',
        [executionId],
      );
      return result.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, execution_id: r.execution_id as string,
        event_type: r.event_type as 'execution_started' | 'node_started' | 'node_succeeded' | 'node_failed'
          | 'node_skipped' | 'execution_succeeded' | 'execution_failed' | 'execution_recovered',
        node_id: (r.node_id as string | null) ?? null,
        payload: safeJsonParse(r.payload), created_at: Number(r.created_at),
      }));
    },
  };
  // ── Triggers ──────────────────────────────────────────────────────────────

  triggers = {
    create: async (data: { id: string; workflow_id: string; trigger_type: 'cron' | 'webhook' | 'event' | 'manual'; config: Record<string, unknown> }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO workflow_triggers (id, workflow_id, trigger_type, config, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, $5, $5)`,
        [data.id, data.workflow_id, data.trigger_type, JSON.stringify(data.config), now],
      );
      const result = await this.conn.pool.query('SELECT * FROM workflow_triggers WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create trigger');
      return mapTrigger(result.rows[0] as Record<string, unknown>);
    },

    getById: async (id: string) => {
      const result = await this.conn.pool.query('SELECT * FROM workflow_triggers WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      return mapTrigger(result.rows[0] as Record<string, unknown>);
    },

    listByWorkflow: async (workflowId: string) => {
      const result = await this.conn.pool.query('SELECT * FROM workflow_triggers WHERE workflow_id = $1', [workflowId]);
      return result.rows.map((r: Record<string, unknown>) => mapTrigger(r));
    },

    listEnabled: async () => {
      const result = await this.conn.pool.query('SELECT * FROM workflow_triggers WHERE enabled = true');
      return result.rows.map((r: Record<string, unknown>) => mapTrigger(r));
    },

    update: async (id: string, data: { config?: Record<string, unknown>; enabled?: boolean }) => {
      const setClauses: string[] = ['updated_at = $2'];
      const params: unknown[] = [id, new Date().toISOString()];
      let paramIdx = 3;
      if (data.config !== undefined) { setClauses.push(`config = $${paramIdx}`); params.push(JSON.stringify(data.config)); paramIdx++; }
      if (data.enabled !== undefined) { setClauses.push(`enabled = $${paramIdx}`); params.push(data.enabled); paramIdx++; }
      await this.conn.pool.query(`UPDATE workflow_triggers SET ${setClauses.join(', ')} WHERE id = $1`, params);
    },

    delete: async (id: string) => {
      await this.conn.pool.query('DELETE FROM workflow_triggers WHERE id = $1', [id]);
    },
  };

  // ── Audit (append-only) ───────────────────────────────────────────────────

  audit = {
    write: async (event: { id: string; actor: string; action: string; resource_type: string; resource_id?: string; details?: Record<string, unknown>; ip_address?: string }) => {
      const now = new Date().toISOString();
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.conn.pool.query(
            `INSERT INTO audit_events (id, timestamp, actor, action, resource_type, resource_id, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [event.id, now, event.actor, event.action, event.resource_type, event.resource_id ?? null, JSON.stringify(event.details ?? {}), event.ip_address ?? null],
          );
          return;
        } catch (err) {
          lastErr = err;
          logger.warn({ attempt, error: String(err) }, 'Audit write failed, retrying');
        }
      }
      throw lastErr;
    },

    list: async (filter: { actor?: string; action?: string; resource_type?: string; resource_id?: string; after?: string; before?: string }, pagination: PaginationParams) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      if (filter.actor) { conditions.push(`actor = $${paramIdx}`); params.push(filter.actor); paramIdx++; }
      if (filter.action) { conditions.push(`action = $${paramIdx}`); params.push(filter.action); paramIdx++; }
      if (filter.resource_type) { conditions.push(`resource_type = $${paramIdx}`); params.push(filter.resource_type); paramIdx++; }
      if (filter.resource_id) { conditions.push(`resource_id = $${paramIdx}`); params.push(filter.resource_id); paramIdx++; }
      if (filter.after) { conditions.push(`timestamp >= $${paramIdx}`); params.push(filter.after); paramIdx++; }
      if (filter.before) { conditions.push(`timestamp <= $${paramIdx}`); params.push(filter.before); paramIdx++; }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countResult = await this.conn.pool.query(`SELECT count(*)::int AS count FROM audit_events ${whereClause}`, params);
      const total = (countResult.rows[0] as { count: number }).count ?? 0;
      const offset = (pagination.page - 1) * pagination.per_page;
      const dataResult = await this.conn.pool.query(
        `SELECT * FROM audit_events ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, pagination.per_page, offset],
      );
      const data = dataResult.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, timestamp: toIsoString(r.timestamp), actor: r.actor as string, action: r.action as string,
        resource_type: r.resource_type as string, resource_id: (r.resource_id as string | null) ?? null,
        details: safeJsonParse(r.details), ip_address: (r.ip_address as string | null) ?? null,
      }));
      return { data, total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page) };
    },
  };

  // ── Users ─────────────────────────────────────────────────────────────────

  users = {
    create: async (data: { id: string; username: string; password_hash: string; email: string; role?: 'read' | 'write' | 'admin'; display_name?: string }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO users (id, username, password_hash, email, role, display_name, created_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [data.id, data.username, data.password_hash, data.email, data.role ?? 'read', data.display_name ?? '', now],
      );
      const result = await this.conn.pool.query('SELECT * FROM users WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create user');
      const r = result.rows[0] as Record<string, unknown>;
      return { id: r.id as string, username: r.username as string, email: r.email as string, role: r.role as string, display_name: (r.display_name as string | null) ?? '', created_at: toIsoString(r.created_at), is_active: r.is_active as boolean };
    },

    getById: async (id: string) => {
      const result = await this.conn.pool.query('SELECT * FROM users WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      const r = result.rows[0] as Record<string, unknown>;
      return { id: r.id as string, username: r.username as string, email: r.email as string, role: r.role as string, password_hash: r.password_hash as string, display_name: (r.display_name as string | null) ?? '', is_active: r.is_active as boolean, last_login_at: toNullableIsoString(r.last_login_at) };
    },

    getByUsername: async (username: string) => {
      const result = await this.conn.pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return null;
      const r = result.rows[0] as Record<string, unknown>;
      return { id: r.id as string, username: r.username as string, email: r.email as string, role: r.role as string, password_hash: r.password_hash as string, display_name: (r.display_name as string | null) ?? '', is_active: r.is_active as boolean, last_login_at: toNullableIsoString(r.last_login_at) };
    },

    updateLastLogin: async (id: string) => {
      await this.conn.pool.query('UPDATE users SET last_login_at = $2 WHERE id = $1', [id, new Date().toISOString()]);
    },

    list: async () => {
      const result = await this.conn.pool.query('SELECT * FROM users');
      return result.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, username: r.username as string, email: r.email as string, role: r.role as string,
        display_name: (r.display_name as string | null) ?? '', is_active: r.is_active as boolean,
        created_at: toIsoString(r.created_at), last_login_at: toNullableIsoString(r.last_login_at),
      }));
    },

    updateRole: async (id: string, role: 'read' | 'write' | 'admin') => {
      await this.conn.pool.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
    },

    deactivate: async (id: string) => {
      await this.conn.pool.query('UPDATE users SET is_active = false WHERE id = $1', [id]);
    },
  };

  // ── Secrets ───────────────────────────────────────────────────────────────

  secrets = {
    create: async (data: { id: string; name: string; encrypted_value: string; scope: 'global' | 'workflow' | 'connector'; scope_id?: string; created_by: string }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO secrets (id, name, encrypted_value, scope, scope_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [data.id, data.name, data.encrypted_value, data.scope, data.scope_id ?? null, data.created_by, now],
      );
    },

    getByName: async (name: string, scope?: string, scopeId?: string) => {
      const conditions: string[] = ['name = $1'];
      const params: unknown[] = [name];
      let paramIdx = 2;
      if (scope) { conditions.push(`scope = $${paramIdx}`); params.push(scope); paramIdx++; }
      if (scopeId) { conditions.push(`scope_id = $${paramIdx}`); params.push(scopeId); paramIdx++; }
      const result = await this.conn.pool.query(`SELECT * FROM secrets WHERE ${conditions.join(' AND ')}`, params);
      if (result.rows.length === 0) return null;
      const r = result.rows[0] as Record<string, unknown>;
      return { id: r.id as string, name: r.name as string, encrypted_value: r.encrypted_value as string, scope: r.scope as string, scope_id: (r.scope_id as string | null) ?? null };
    },

    list: async (scope?: string, scopeId?: string) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      if (scope) { conditions.push(`scope = $${paramIdx}`); params.push(scope); paramIdx++; }
      if (scopeId) { conditions.push(`scope_id = $${paramIdx}`); params.push(scopeId); paramIdx++; }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await this.conn.pool.query(`SELECT * FROM secrets ${whereClause}`, params);
      return result.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, scope: r.scope as string,
        scope_id: (r.scope_id as string | null) ?? null, created_at: toIsoString(r.created_at),
      }));
    },

    update: async (id: string, encrypted_value: string) => {
      await this.conn.pool.query('UPDATE secrets SET encrypted_value = $2, updated_at = $3 WHERE id = $1', [id, encrypted_value, new Date().toISOString()]);
    },

    delete: async (id: string) => {
      await this.conn.pool.query('DELETE FROM secrets WHERE id = $1', [id]);
    },
  };

  // ── Egress Policies ───────────────────────────────────────────────────────

  egressPolicies = {
    create: async (data: { id: string; name: string; rule_type: 'allow' | 'deny'; target_type: 'domain' | 'ip_range' | 'region'; target_value: string; priority?: number }) => {
      await this.conn.pool.query(
        `INSERT INTO egress_policies (id, name, rule_type, target_type, target_value, priority, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [data.id, data.name, data.rule_type, data.target_type, data.target_value, data.priority ?? 0],
      );
    },

    listEnabled: async () => {
      const result = await this.conn.pool.query('SELECT * FROM egress_policies WHERE enabled = true ORDER BY priority DESC');
      return result.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, rule_type: r.rule_type as 'allow' | 'deny',
        target_type: r.target_type as 'domain' | 'ip_range' | 'region', target_value: r.target_value as string,
        priority: r.priority as number, enabled: r.enabled as boolean,
      }));
    },

    list: async () => {
      const result = await this.conn.pool.query('SELECT * FROM egress_policies ORDER BY priority DESC');
      return result.rows.map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, rule_type: r.rule_type as 'allow' | 'deny',
        target_type: r.target_type as 'domain' | 'ip_range' | 'region', target_value: r.target_value as string,
        priority: r.priority as number, enabled: r.enabled as boolean, created_at: toIsoString(r.created_at),
      }));
    },

    update: async (id: string, data: { name?: string; rule_type?: 'allow' | 'deny'; target_type?: 'domain' | 'ip_range' | 'region'; target_value?: string; priority?: number; enabled?: boolean }) => {
      const setClauses: string[] = [];
      const params: unknown[] = [id];
      let paramIdx = 2;
      if (data.name !== undefined) { setClauses.push(`name = $${paramIdx}`); params.push(data.name); paramIdx++; }
      if (data.rule_type !== undefined) { setClauses.push(`rule_type = $${paramIdx}`); params.push(data.rule_type); paramIdx++; }
      if (data.target_type !== undefined) { setClauses.push(`target_type = $${paramIdx}`); params.push(data.target_type); paramIdx++; }
      if (data.target_value !== undefined) { setClauses.push(`target_value = $${paramIdx}`); params.push(data.target_value); paramIdx++; }
      if (data.priority !== undefined) { setClauses.push(`priority = $${paramIdx}`); params.push(data.priority); paramIdx++; }
      if (data.enabled !== undefined) { setClauses.push(`enabled = $${paramIdx}`); params.push(data.enabled); paramIdx++; }
      if (setClauses.length === 0) return;
      await this.conn.pool.query(`UPDATE egress_policies SET ${setClauses.join(', ')} WHERE id = $1`, params);
    },

    delete: async (id: string) => {
      await this.conn.pool.query('DELETE FROM egress_policies WHERE id = $1', [id]);
    },
  };

  // ── Connectors ────────────────────────────────────────────────────────────

  connectors = {
    create: async (data: { id: string; connector_type: 'vault' | 'desk' | 'recap' | 'generic'; name: string; config: Record<string, unknown> }) => {
      const now = new Date().toISOString();
      await this.conn.pool.query(
        `INSERT INTO connectors (id, connector_type, name, config, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'disconnected', $5, $5)`,
        [data.id, data.connector_type, data.name, JSON.stringify(data.config), now],
      );
      const result = await this.conn.pool.query('SELECT * FROM connectors WHERE id = $1', [data.id]);
      if (result.rows.length === 0) throw new Error('Failed to create connector');
      return mapConnector(result.rows[0] as Record<string, unknown>);
    },

    getById: async (id: string) => {
      const result = await this.conn.pool.query('SELECT * FROM connectors WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;
      return mapConnector(result.rows[0] as Record<string, unknown>);
    },

    list: async () => {
      const result = await this.conn.pool.query('SELECT * FROM connectors');
      return result.rows.map((r: Record<string, unknown>) => mapConnector(r));
    },

    update: async (id: string, data: { name?: string; config?: Record<string, unknown>; status?: 'connected' | 'disconnected' | 'error'; last_health_check?: string }) => {
      const setClauses: string[] = ['updated_at = $2'];
      const params: unknown[] = [id, new Date().toISOString()];
      let paramIdx = 3;
      if (data.name !== undefined) { setClauses.push(`name = $${paramIdx}`); params.push(data.name); paramIdx++; }
      if (data.config !== undefined) { setClauses.push(`config = $${paramIdx}`); params.push(JSON.stringify(data.config)); paramIdx++; }
      if (data.status !== undefined) { setClauses.push(`status = $${paramIdx}`); params.push(data.status); paramIdx++; }
      if (data.last_health_check !== undefined) { setClauses.push(`last_health_check = $${paramIdx}`); params.push(data.last_health_check); paramIdx++; }
      await this.conn.pool.query(`UPDATE connectors SET ${setClauses.join(', ')} WHERE id = $1`, params);
    },

    delete: async (id: string) => {
      await this.conn.pool.query('DELETE FROM connectors WHERE id = $1', [id]);
    },
  };
}
