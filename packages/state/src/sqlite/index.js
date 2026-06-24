/**
 * SQLite implementation of the StateStore interface.
 */
import { eq, and, desc, asc, like, or, sql } from 'drizzle-orm';
import { createLogger } from '@loop/observability';
import * as schema from '../schema.js';
import { runMigrations } from '../migrate.js';
const logger = createLogger({ name: 'loop:state:sqlite', component: 'state' });
function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
function mapWorkflow(row) {
    return {
        id: row.id, name: row.name, description: row.description,
        definition: safeJsonParse(row.definition),
        version: row.version,
        status: row.status,
        tags: safeJsonParse(row.tags),
        created_by: row.created_by, updated_by: row.updated_by,
        created_at: row.created_at, updated_at: row.updated_at,
    };
}
function mapExecution(row) {
    return {
        id: row.id, workflow_id: row.workflow_id, workflow_version: row.workflow_version,
        trigger_type: row.trigger_type,
        trigger_payload: safeJsonParse(row.trigger_payload),
        status: row.status,
        started_at: row.started_at, completed_at: row.completed_at,
        duration_ms: row.duration_ms, error: row.error, initiated_by: row.initiated_by,
    };
}
function mapNodeExecution(row) {
    return {
        id: row.id, execution_id: row.execution_id, node_id: row.node_id, node_type: row.node_type,
        status: row.status,
        input: safeJsonParse(row.input), output: safeJsonParse(row.output),
        error: row.error, started_at: row.started_at, completed_at: row.completed_at,
        retry_count: row.retry_count, metadata: safeJsonParse(row.metadata),
    };
}
export class SqliteStateStore {
    conn;
    constructor(conn) {
        this.conn = conn;
    }
    async initialise() {
        await runMigrations(this.conn);
        logger.info('State store initialised (SQLite)');
    }
    async close() {
        this.conn.close();
    }
    get db() { return this.conn.db; }
    // ── Workflows ─────────────────────────────────────────────────────────────
    workflows = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.workflows).values({
                id: data.id, name: data.name, description: data.description,
                definition: JSON.stringify(data.definition),
                version: 1, status: 'draft',
                tags: JSON.stringify(data.tags ?? []),
                created_by: data.created_by, updated_by: data.created_by,
                created_at: now, updated_at: now,
            }).run();
            const row = this.db.select().from(schema.workflows).where(eq(schema.workflows.id, data.id)).get();
            return mapWorkflow(row);
        },
        getById: async (id) => {
            const row = this.db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).get();
            return row ? mapWorkflow(row) : null;
        },
        list: async (filter, pagination) => {
            const conditions = [];
            if (filter.status)
                conditions.push(eq(schema.workflows.status, filter.status));
            if (filter.tag)
                conditions.push(sql `${schema.workflows.tags} LIKE ${`%"${filter.tag}"%`}`);
            if (filter.search) {
                conditions.push(or(like(schema.workflows.name, `%${filter.search}%`), like(schema.workflows.description, `%${filter.search}%`)));
            }
            const where = conditions.length ? and(...conditions) : undefined;
            const countResult = this.db.select({ count: sql `count(*)` }).from(schema.workflows).where(where).get();
            const total = countResult?.count ?? 0;
            const [sortField, sortDir] = (filter.sort ?? 'updated_at:desc').split(':');
            const sortCol = sortField === 'created_at' ? schema.workflows.created_at : schema.workflows.updated_at;
            const orderFn = sortDir === 'asc' ? asc : desc;
            const rows = this.db.select().from(schema.workflows).where(where)
                .orderBy(orderFn(sortCol)).limit(pagination.per_page).offset((pagination.page - 1) * pagination.per_page).all();
            return { data: rows.map(mapWorkflow), total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page) };
        },
        update: async (id, data) => {
            const now = new Date().toISOString();
            const updates = { updated_at: now, updated_by: data.updated_by };
            if (data.name !== undefined)
                updates.name = data.name;
            if (data.description !== undefined)
                updates.description = data.description;
            if (data.definition !== undefined) {
                updates.definition = JSON.stringify(data.definition);
                const current = this.db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).get();
                if (current)
                    updates.version = current.version + 1;
            }
            if (data.status !== undefined)
                updates.status = data.status;
            if (data.tags !== undefined)
                updates.tags = JSON.stringify(data.tags);
            this.db.update(schema.workflows).set(updates).where(eq(schema.workflows.id, id)).run();
            return (await this.workflows.getById(id));
        },
        archive: async (id) => {
            this.db.update(schema.workflows).set({ status: 'archived' }).where(eq(schema.workflows.id, id)).run();
        },
        delete: async (id) => {
            this.db.delete(schema.nodeExecutions).where(eq(schema.nodeExecutions.execution_id, id)).run();
            this.db.delete(schema.workflowExecutions).where(eq(schema.workflowExecutions.workflow_id, id)).run();
            this.db.delete(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.workflow_id, id)).run();
            this.db.delete(schema.workflowTriggers).where(eq(schema.workflowTriggers.workflow_id, id)).run();
            this.db.delete(schema.workflows).where(eq(schema.workflows.id, id)).run();
        },
    };
    // ── Workflow Definitions ──────────────────────────────────────────────────
    workflowDefinitions = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.workflowDefinitions).values({
                id: data.id, workflow_id: data.workflow_id, version: data.version,
                definition: JSON.stringify(data.definition),
                commit_hash: data.commit_hash, created_by: data.created_by,
                created_at: now, change_summary: data.change_summary ?? '',
            }).run();
            const row = this.db.select().from(schema.workflowDefinitions).where(eq(schema.workflowDefinitions.id, data.id)).get();
            const r = row;
            return { id: r.id, workflow_id: r.workflow_id, version: r.version,
                definition: safeJsonParse(r.definition),
                commit_hash: r.commit_hash, created_by: r.created_by, created_at: r.created_at, change_summary: r.change_summary };
        },
        listByWorkflow: async (workflowId) => {
            const rows = this.db.select().from(schema.workflowDefinitions)
                .where(eq(schema.workflowDefinitions.workflow_id, workflowId))
                .orderBy(desc(schema.workflowDefinitions.version)).all();
            return rows.map((r) => ({
                id: r.id, workflow_id: r.workflow_id, version: r.version,
                definition: safeJsonParse(r.definition),
                commit_hash: r.commit_hash, created_by: r.created_by, created_at: r.created_at, change_summary: r.change_summary,
            }));
        },
        getByWorkflowAndVersion: async (workflowId, version) => {
            const row = this.db.select().from(schema.workflowDefinitions)
                .where(and(eq(schema.workflowDefinitions.workflow_id, workflowId), eq(schema.workflowDefinitions.version, version))).get();
            if (!row)
                return null;
            return { id: row.id, workflow_id: row.workflow_id, version: row.version,
                definition: safeJsonParse(row.definition),
                commit_hash: row.commit_hash, created_by: row.created_by, created_at: row.created_at, change_summary: row.change_summary };
        },
    };
    // ── Executions ────────────────────────────────────────────────────────────
    executions = {
        create: async (data) => {
            this.db.insert(schema.workflowExecutions).values({
                id: data.id, workflow_id: data.workflow_id, workflow_version: data.workflow_version,
                trigger_type: data.trigger_type,
                trigger_payload: JSON.stringify(data.trigger_payload ?? {}),
                status: 'pending', initiated_by: data.initiated_by ?? null,
            }).run();
            const row = this.db.select().from(schema.workflowExecutions).where(eq(schema.workflowExecutions.id, data.id)).get();
            return mapExecution(row);
        },
        getById: async (id) => {
            const row = this.db.select().from(schema.workflowExecutions).where(eq(schema.workflowExecutions.id, id)).get();
            return row ? mapExecution(row) : null;
        },
        list: async (filter, pagination) => {
            const conditions = [];
            if (filter.workflow_id)
                conditions.push(eq(schema.workflowExecutions.workflow_id, filter.workflow_id));
            if (filter.status)
                conditions.push(eq(schema.workflowExecutions.status, filter.status));
            if (filter.trigger_type)
                conditions.push(eq(schema.workflowExecutions.trigger_type, filter.trigger_type));
            if (filter.started_after)
                conditions.push(sql `${schema.workflowExecutions.started_at} >= ${filter.started_after}`);
            if (filter.started_before)
                conditions.push(sql `${schema.workflowExecutions.started_at} <= ${filter.started_before}`);
            const where = conditions.length ? and(...conditions) : undefined;
            const countResult = this.db.select({ count: sql `count(*)` }).from(schema.workflowExecutions).where(where).get();
            const total = countResult?.count ?? 0;
            const rows = this.db.select().from(schema.workflowExecutions).where(where)
                .orderBy(desc(schema.workflowExecutions.started_at)).limit(pagination.per_page).offset((pagination.page - 1) * pagination.per_page).all();
            return { data: rows.map(mapExecution), total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page) };
        },
        updateStatus: async (id, data) => {
            this.db.update(schema.workflowExecutions).set({
                status: data.status,
                started_at: data.started_at ?? null,
                completed_at: data.completed_at ?? null,
                duration_ms: data.duration_ms ?? null,
                error: data.error ?? null,
            }).where(eq(schema.workflowExecutions.id, id)).run();
        },
        findInterrupted: async () => {
            const rows = this.db.select().from(schema.workflowExecutions).where(eq(schema.workflowExecutions.status, 'running')).all();
            return rows.map(mapExecution);
        },
    };
    // ── Node Executions ───────────────────────────────────────────────────────
    nodeExecutions = {
        create: async (data) => {
            this.db.insert(schema.nodeExecutions).values({
                id: data.id, execution_id: data.execution_id, node_id: data.node_id, node_type: data.node_type,
                status: 'pending', input: JSON.stringify(data.input ?? {}),
            }).run();
            const row = this.db.select().from(schema.nodeExecutions).where(eq(schema.nodeExecutions.id, data.id)).get();
            return mapNodeExecution(row);
        },
        listByExecution: async (executionId) => {
            const rows = this.db.select().from(schema.nodeExecutions)
                .where(eq(schema.nodeExecutions.execution_id, executionId)).orderBy(schema.nodeExecutions.started_at).all();
            return rows.map(mapNodeExecution);
        },
        updateStatus: async (id, data) => {
            this.db.update(schema.nodeExecutions).set({
                status: data.status,
                started_at: data.started_at ?? null,
                completed_at: data.completed_at ?? null,
                output: data.output ? JSON.stringify(data.output) : undefined,
                error: data.error ?? null,
                retry_count: data.retry_count ?? undefined,
                metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
            }).where(eq(schema.nodeExecutions.id, id)).run();
        },
    };
    // ── Triggers ──────────────────────────────────────────────────────────────
    triggers = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.workflowTriggers).values({
                id: data.id, workflow_id: data.workflow_id, trigger_type: data.trigger_type,
                config: JSON.stringify(data.config), enabled: true, created_at: now, updated_at: now,
            }).run();
            const row = this.db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.id, data.id)).get();
            const r = row;
            return { id: r.id, workflow_id: r.workflow_id, trigger_type: r.trigger_type, config: safeJsonParse(r.config), enabled: r.enabled, created_at: r.created_at, updated_at: r.updated_at };
        },
        getById: async (id) => {
            const row = this.db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.id, id)).get();
            if (!row)
                return null;
            return { id: row.id, workflow_id: row.workflow_id, trigger_type: row.trigger_type, config: safeJsonParse(row.config), enabled: row.enabled, created_at: row.created_at, updated_at: row.updated_at };
        },
        listByWorkflow: async (workflowId) => {
            const rows = this.db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.workflow_id, workflowId)).all();
            return rows.map((r) => ({ id: r.id, workflow_id: r.workflow_id, trigger_type: r.trigger_type, config: safeJsonParse(r.config), enabled: r.enabled, created_at: r.created_at, updated_at: r.updated_at }));
        },
        listEnabled: async () => {
            const rows = this.db.select().from(schema.workflowTriggers).where(eq(schema.workflowTriggers.enabled, true)).all();
            return rows.map((r) => ({ id: r.id, workflow_id: r.workflow_id, trigger_type: r.trigger_type, config: safeJsonParse(r.config), enabled: r.enabled, created_at: r.created_at, updated_at: r.updated_at }));
        },
        update: async (id, data) => {
            this.db.update(schema.workflowTriggers).set({
                config: data.config ? JSON.stringify(data.config) : undefined,
                enabled: data.enabled, updated_at: new Date().toISOString(),
            }).where(eq(schema.workflowTriggers.id, id)).run();
        },
        delete: async (id) => {
            this.db.delete(schema.workflowTriggers).where(eq(schema.workflowTriggers.id, id)).run();
        },
    };
    // ── Audit ─────────────────────────────────────────────────────────────────
    audit = {
        write: async (event) => {
            const now = new Date().toISOString();
            let lastErr;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    this.db.insert(schema.auditEvents).values({
                        id: event.id, timestamp: now, actor: event.actor, action: event.action,
                        resource_type: event.resource_type, resource_id: event.resource_id ?? null,
                        details: JSON.stringify(event.details ?? {}),
                        ip_address: event.ip_address ?? null,
                    }).run();
                    return;
                }
                catch (err) {
                    lastErr = err;
                    logger.warn({ attempt, error: String(err) }, 'Audit write failed, retrying');
                }
            }
            throw lastErr;
        },
        list: async (filter, pagination) => {
            const conditions = [];
            if (filter.actor)
                conditions.push(eq(schema.auditEvents.actor, filter.actor));
            if (filter.action)
                conditions.push(eq(schema.auditEvents.action, filter.action));
            if (filter.resource_type)
                conditions.push(eq(schema.auditEvents.resource_type, filter.resource_type));
            if (filter.resource_id)
                conditions.push(eq(schema.auditEvents.resource_id, filter.resource_id));
            if (filter.after)
                conditions.push(sql `${schema.auditEvents.timestamp} >= ${filter.after}`);
            if (filter.before)
                conditions.push(sql `${schema.auditEvents.timestamp} <= ${filter.before}`);
            const where = conditions.length ? and(...conditions) : undefined;
            const countResult = this.db.select({ count: sql `count(*)` }).from(schema.auditEvents).where(where).get();
            const total = countResult?.count ?? 0;
            const rows = this.db.select().from(schema.auditEvents).where(where).orderBy(desc(schema.auditEvents.timestamp)).limit(pagination.per_page).offset((pagination.page - 1) * pagination.per_page).all();
            return {
                data: rows.map((r) => ({ id: r.id, timestamp: r.timestamp, actor: r.actor, action: r.action, resource_type: r.resource_type, resource_id: r.resource_id, details: safeJsonParse(r.details), ip_address: r.ip_address })),
                total, page: pagination.page, per_page: pagination.per_page, total_pages: Math.ceil(total / pagination.per_page),
            };
        },
    };
    // ── Users ─────────────────────────────────────────────────────────────────
    users = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.users).values({
                id: data.id, username: data.username, password_hash: data.password_hash, email: data.email,
                role: data.role ?? 'read', display_name: data.display_name ?? '', created_at: now, is_active: true,
            }).run();
            const row = this.db.select().from(schema.users).where(eq(schema.users.id, data.id)).get();
            const r = row;
            return { id: r.id, username: r.username, email: r.email, role: r.role, display_name: r.display_name ?? '', created_at: r.created_at, is_active: r.is_active };
        },
        getById: async (id) => {
            const row = this.db.select().from(schema.users).where(eq(schema.users.id, id)).get();
            return row ? { id: row.id, username: row.username, email: row.email, role: row.role, password_hash: row.password_hash, display_name: row.display_name ?? '', is_active: row.is_active, last_login_at: row.last_login_at } : null;
        },
        getByUsername: async (username) => {
            const row = this.db.select().from(schema.users).where(eq(schema.users.username, username)).get();
            return row ? { id: row.id, username: row.username, email: row.email, role: row.role, password_hash: row.password_hash, display_name: row.display_name ?? '', is_active: row.is_active, last_login_at: row.last_login_at } : null;
        },
        updateLastLogin: async (id) => {
            this.db.update(schema.users).set({ last_login_at: new Date().toISOString() }).where(eq(schema.users.id, id)).run();
        },
        list: async () => {
            const rows = this.db.select().from(schema.users).all();
            return rows.map((r) => ({ id: r.id, username: r.username, email: r.email, role: r.role, display_name: r.display_name ?? '', is_active: r.is_active, created_at: r.created_at, last_login_at: r.last_login_at }));
        },
        updateRole: async (id, role) => {
            this.db.update(schema.users).set({ role }).where(eq(schema.users.id, id)).run();
        },
        deactivate: async (id) => {
            this.db.update(schema.users).set({ is_active: false }).where(eq(schema.users.id, id)).run();
        },
    };
    // ── Secrets ───────────────────────────────────────────────────────────────
    secrets = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.secrets).values({
                id: data.id, name: data.name, encrypted_value: data.encrypted_value,
                scope: data.scope, scope_id: data.scope_id ?? null, created_by: data.created_by,
                created_at: now, updated_at: now,
            }).run();
        },
        getByName: async (name, scope, scopeId) => {
            const conditions = [eq(schema.secrets.name, name)];
            if (scope)
                conditions.push(eq(schema.secrets.scope, scope));
            if (scopeId)
                conditions.push(eq(schema.secrets.scope_id, scopeId));
            const row = this.db.select().from(schema.secrets).where(and(...conditions)).get();
            return row ? { id: row.id, name: row.name, encrypted_value: row.encrypted_value, scope: row.scope, scope_id: row.scope_id } : null;
        },
        list: async (scope, scopeId) => {
            const conditions = [];
            if (scope)
                conditions.push(eq(schema.secrets.scope, scope));
            if (scopeId)
                conditions.push(eq(schema.secrets.scope_id, scopeId));
            const where = conditions.length ? and(...conditions) : undefined;
            const rows = this.db.select().from(schema.secrets).where(where).all();
            return rows.map((r) => ({ id: r.id, name: r.name, scope: r.scope, scope_id: r.scope_id, created_at: r.created_at }));
        },
        update: async (id, encrypted_value) => {
            this.db.update(schema.secrets).set({ encrypted_value, updated_at: new Date().toISOString() }).where(eq(schema.secrets.id, id)).run();
        },
        delete: async (id) => {
            this.db.delete(schema.secrets).where(eq(schema.secrets.id, id)).run();
        },
    };
    // ── Egress Policies ───────────────────────────────────────────────────────
    egressPolicies = {
        create: async (data) => {
            this.db.insert(schema.egressPolicies).values({
                id: data.id, name: data.name, rule_type: data.rule_type, target_type: data.target_type,
                target_value: data.target_value, priority: data.priority ?? 0, enabled: true,
            }).run();
        },
        listEnabled: async () => {
            const rows = this.db.select().from(schema.egressPolicies).where(eq(schema.egressPolicies.enabled, true)).orderBy(desc(schema.egressPolicies.priority)).all();
            return rows.map((r) => ({ id: r.id, name: r.name, rule_type: r.rule_type, target_type: r.target_type, target_value: r.target_value, priority: r.priority, enabled: r.enabled }));
        },
        list: async () => {
            const rows = this.db.select().from(schema.egressPolicies).orderBy(desc(schema.egressPolicies.priority)).all();
            return rows.map((r) => ({ id: r.id, name: r.name, rule_type: r.rule_type, target_type: r.target_type, target_value: r.target_value, priority: r.priority, enabled: r.enabled, created_at: r.created_at }));
        },
        update: async (id, data) => {
            this.db.update(schema.egressPolicies).set({
                name: data.name, rule_type: data.rule_type, target_type: data.target_type,
                target_value: data.target_value, priority: data.priority, enabled: data.enabled,
            }).where(eq(schema.egressPolicies.id, id)).run();
        },
        delete: async (id) => {
            this.db.delete(schema.egressPolicies).where(eq(schema.egressPolicies.id, id)).run();
        },
    };
    // ── Connectors ────────────────────────────────────────────────────────────
    connectors = {
        create: async (data) => {
            const now = new Date().toISOString();
            this.db.insert(schema.connectors).values({
                id: data.id, connector_type: data.connector_type, name: data.name,
                config: JSON.stringify(data.config), status: 'disconnected', created_at: now, updated_at: now,
            }).run();
            const row = this.db.select().from(schema.connectors).where(eq(schema.connectors.id, data.id)).get();
            const r = row;
            return { id: r.id, connector_type: r.connector_type, name: r.name, config: safeJsonParse(r.config), status: r.status, last_health_check: r.last_health_check, created_at: r.created_at, updated_at: r.updated_at };
        },
        getById: async (id) => {
            const row = this.db.select().from(schema.connectors).where(eq(schema.connectors.id, id)).get();
            if (!row)
                return null;
            return { id: row.id, connector_type: row.connector_type, name: row.name, config: safeJsonParse(row.config), status: row.status, last_health_check: row.last_health_check, created_at: row.created_at, updated_at: row.updated_at };
        },
        list: async () => {
            const rows = this.db.select().from(schema.connectors).all();
            return rows.map((r) => ({ id: r.id, connector_type: r.connector_type, name: r.name, config: safeJsonParse(r.config), status: r.status, last_health_check: r.last_health_check, created_at: r.created_at, updated_at: r.updated_at }));
        },
        update: async (id, data) => {
            this.db.update(schema.connectors).set({
                name: data.name, config: data.config ? JSON.stringify(data.config) : undefined,
                status: data.status, last_health_check: data.last_health_check, updated_at: new Date().toISOString(),
            }).where(eq(schema.connectors.id, id)).run();
        },
        delete: async (id) => {
            this.db.delete(schema.connectors).where(eq(schema.connectors.id, id)).run();
        },
    };
}
//# sourceMappingURL=index.js.map