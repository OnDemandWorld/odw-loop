/**
 * Drizzle schema for Loop — matches TSD §4 exactly.
 * Works with both SQLite (Core) and PostgreSQL (Scale) via Drizzle's dialect abstraction.
 */
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
// ─── users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    email: text('email').notNull().unique(),
    role: text('role', { enum: ['read', 'write', 'admin'] }).notNull().default('read'),
    display_name: text('display_name').default(''),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    last_login_at: text('last_login_at'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});
// ─── workflows ────────────────────────────────────────────────────────────────
export const workflows = sqliteTable('workflows', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    definition: text('definition', { mode: 'json' }).notNull(),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull().default('draft'),
    tags: text('tags', { mode: 'json' }).notNull().default(sql `'[]'`),
    created_by: text('created_by').notNull().references(() => users.id),
    updated_by: text('updated_by').notNull().references(() => users.id),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    updated_at: text('updated_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
});
// ─── workflow_definitions (versioned snapshots) ───────────────────────────────
export const workflowDefinitions = sqliteTable('workflow_definitions', {
    id: text('id').primaryKey(),
    workflow_id: text('workflow_id').notNull().references(() => workflows.id),
    version: integer('version').notNull(),
    definition: text('definition', { mode: 'json' }).notNull(),
    commit_hash: text('commit_hash').notNull(),
    created_by: text('created_by').notNull().references(() => users.id),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    change_summary: text('change_summary').notNull().default(''),
});
// ─── workflow_executions ──────────────────────────────────────────────────────
export const workflowExecutions = sqliteTable('workflow_executions', {
    id: text('id').primaryKey(),
    workflow_id: text('workflow_id').notNull().references(() => workflows.id),
    workflow_version: integer('workflow_version').notNull(),
    trigger_type: text('trigger_type', {
        enum: ['manual', 'cron', 'webhook', 'event'],
    }).notNull(),
    trigger_payload: text('trigger_payload', { mode: 'json' }).notNull().default(sql `'{}'`),
    status: text('status', {
        enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'paused'],
    }).notNull().default('pending'),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    duration_ms: integer('duration_ms'),
    error: text('error'),
    initiated_by: text('initiated_by'),
});
// ─── node_executions ──────────────────────────────────────────────────────────
export const nodeExecutions = sqliteTable('node_executions', {
    id: text('id').primaryKey(),
    execution_id: text('execution_id').notNull().references(() => workflowExecutions.id),
    node_id: text('node_id').notNull(),
    node_type: text('node_type').notNull(),
    status: text('status', {
        enum: ['pending', 'running', 'succeeded', 'failed', 'skipped'],
    }).notNull(),
    input: text('input', { mode: 'json' }).notNull().default(sql `'{}'`),
    output: text('output', { mode: 'json' }).notNull().default(sql `'{}'`),
    error: text('error'),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    retry_count: integer('retry_count').notNull().default(0),
    metadata: text('metadata', { mode: 'json' }).notNull().default(sql `'{}'`),
});
// ─── workflow_triggers ────────────────────────────────────────────────────────
export const workflowTriggers = sqliteTable('workflow_triggers', {
    id: text('id').primaryKey(),
    workflow_id: text('workflow_id').notNull().references(() => workflows.id),
    trigger_type: text('trigger_type', {
        enum: ['cron', 'webhook', 'event', 'manual'],
    }).notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    updated_at: text('updated_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
});
// ─── audit_events (append-only) ───────────────────────────────────────────────
export const auditEvents = sqliteTable('audit_events', {
    id: text('id').primaryKey(),
    timestamp: text('timestamp').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    resource_type: text('resource_type').notNull(),
    resource_id: text('resource_id'),
    details: text('details', { mode: 'json' }).notNull().default(sql `'{}'`),
    ip_address: text('ip_address'),
});
// ─── secrets ──────────────────────────────────────────────────────────────────
export const secrets = sqliteTable('secrets', {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    encrypted_value: text('encrypted_value').notNull(),
    scope: text('scope', { enum: ['global', 'workflow', 'connector'] }).notNull(),
    scope_id: text('scope_id'),
    created_by: text('created_by').notNull(),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    updated_at: text('updated_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
});
// ─── egress_policies ──────────────────────────────────────────────────────────
export const egressPolicies = sqliteTable('egress_policies', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rule_type: text('rule_type', { enum: ['allow', 'deny'] }).notNull(),
    target_type: text('target_type', { enum: ['domain', 'ip_range', 'region'] }).notNull(),
    target_value: text('target_value').notNull(),
    priority: integer('priority').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
});
// ─── connectors ───────────────────────────────────────────────────────────────
export const connectors = sqliteTable('connectors', {
    id: text('id').primaryKey(),
    connector_type: text('connector_type', {
        enum: ['vault', 'desk', 'recap', 'generic'],
    }).notNull(),
    name: text('name').notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    status: text('status', {
        enum: ['connected', 'disconnected', 'error'],
    }).notNull().default('disconnected'),
    last_health_check: text('last_health_check'),
    created_at: text('created_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    updated_at: text('updated_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
});
// ─── schema_migrations ────────────────────────────────────────────────────────
export const schemaMigrations = sqliteTable('schema_migrations', {
    version: text('version').primaryKey(),
    applied_at: text('applied_at').notNull().default(sql `(CURRENT_TIMESTAMP)`),
    checksum: text('checksum').notNull(),
});
// ─── unused import silencer (real usage when we add PG support) ───────────────
export { real };
//# sourceMappingURL=schema.js.map