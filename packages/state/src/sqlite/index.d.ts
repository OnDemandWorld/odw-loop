/**
 * SQLite implementation of the StateStore interface.
 */
import type { WorkflowDefinition } from '@loop/types';
import type { StateStore, PaginationParams, PaginatedResult, WorkflowFilter, ExecutionFilter } from '../interface.js';
import * as schema from '../schema.js';
import type { SqliteConnection } from './connection.js';
type WfRow = typeof schema.workflows.$inferSelect;
declare function mapWorkflow(row: WfRow): {
    id: string;
    name: string;
    description: string;
    definition: WorkflowDefinition;
    version: number;
    status: "draft" | "active" | "archived";
    tags: string[];
    created_by: string;
    updated_by: string;
    created_at: string;
    updated_at: string;
};
export declare class SqliteStateStore implements StateStore {
    private conn;
    constructor(conn: SqliteConnection);
    initialise(): Promise<void>;
    close(): Promise<void>;
    private get db();
    workflows: {
        create: (data: {
            id: string;
            name: string;
            description: string;
            definition: WorkflowDefinition;
            created_by: string;
            tags?: string[];
        }) => Promise<{
            id: string;
            name: string;
            description: string;
            definition: WorkflowDefinition;
            version: number;
            status: "draft" | "active" | "archived";
            tags: string[];
            created_by: string;
            updated_by: string;
            created_at: string;
            updated_at: string;
        }>;
        getById: (id: string) => Promise<{
            id: string;
            name: string;
            description: string;
            definition: WorkflowDefinition;
            version: number;
            status: "draft" | "active" | "archived";
            tags: string[];
            created_by: string;
            updated_by: string;
            created_at: string;
            updated_at: string;
        } | null>;
        list: (filter: WorkflowFilter, pagination: PaginationParams) => Promise<PaginatedResult<ReturnType<typeof mapWorkflow>>>;
        update: (id: string, data: {
            name?: string;
            description?: string;
            definition?: WorkflowDefinition;
            status?: "draft" | "active" | "archived";
            tags?: string[];
            updated_by: string;
        }) => Promise<{
            id: string;
            name: string;
            description: string;
            definition: WorkflowDefinition;
            version: number;
            status: "draft" | "active" | "archived";
            tags: string[];
            created_by: string;
            updated_by: string;
            created_at: string;
            updated_at: string;
        }>;
        archive: (id: string) => Promise<void>;
        delete: (id: string) => Promise<void>;
    };
    workflowDefinitions: {
        create: (data: {
            id: string;
            workflow_id: string;
            version: number;
            definition: WorkflowDefinition;
            commit_hash: string;
            created_by: string;
            change_summary?: string;
        }) => Promise<{
            id: string;
            workflow_id: string;
            version: number;
            definition: WorkflowDefinition;
            commit_hash: string;
            created_by: string;
            created_at: string;
            change_summary: string;
        }>;
        listByWorkflow: (workflowId: string) => Promise<{
            id: string;
            workflow_id: string;
            version: number;
            definition: WorkflowDefinition;
            commit_hash: string;
            created_by: string;
            created_at: string;
            change_summary: string;
        }[]>;
        getByWorkflowAndVersion: (workflowId: string, version: number) => Promise<{
            id: string;
            workflow_id: string;
            version: number;
            definition: WorkflowDefinition;
            commit_hash: string;
            created_by: string;
            created_at: string;
            change_summary: string;
        } | null>;
    };
    executions: {
        create: (data: {
            id: string;
            workflow_id: string;
            workflow_version: number;
            trigger_type: "manual" | "cron" | "webhook" | "event";
            trigger_payload?: Record<string, unknown>;
            initiated_by?: string;
        }) => Promise<{
            id: string;
            workflow_id: string;
            workflow_version: number;
            trigger_type: "manual" | "cron" | "webhook" | "event";
            trigger_payload: Record<string, unknown>;
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
            started_at: string | null;
            completed_at: string | null;
            duration_ms: number | null;
            error: string | null;
            initiated_by: string | null;
        }>;
        getById: (id: string) => Promise<{
            id: string;
            workflow_id: string;
            workflow_version: number;
            trigger_type: "manual" | "cron" | "webhook" | "event";
            trigger_payload: Record<string, unknown>;
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
            started_at: string | null;
            completed_at: string | null;
            duration_ms: number | null;
            error: string | null;
            initiated_by: string | null;
        } | null>;
        list: (filter: ExecutionFilter, pagination: PaginationParams) => Promise<{
            data: {
                id: string;
                workflow_id: string;
                workflow_version: number;
                trigger_type: "manual" | "cron" | "webhook" | "event";
                trigger_payload: Record<string, unknown>;
                status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
                started_at: string | null;
                completed_at: string | null;
                duration_ms: number | null;
                error: string | null;
                initiated_by: string | null;
            }[];
            total: number;
            page: number;
            per_page: number;
            total_pages: number;
        }>;
        updateStatus: (id: string, data: {
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
            started_at?: string;
            completed_at?: string;
            duration_ms?: number;
            error?: string;
        }) => Promise<void>;
        findInterrupted: () => Promise<{
            id: string;
            workflow_id: string;
            workflow_version: number;
            trigger_type: "manual" | "cron" | "webhook" | "event";
            trigger_payload: Record<string, unknown>;
            status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
            started_at: string | null;
            completed_at: string | null;
            duration_ms: number | null;
            error: string | null;
            initiated_by: string | null;
        }[]>;
    };
    nodeExecutions: {
        create: (data: {
            id: string;
            execution_id: string;
            node_id: string;
            node_type: string;
            input?: Record<string, unknown>;
        }) => Promise<{
            id: string;
            execution_id: string;
            node_id: string;
            node_type: string;
            status: "pending" | "running" | "succeeded" | "failed" | "skipped";
            input: Record<string, unknown>;
            output: Record<string, unknown>;
            error: string | null;
            started_at: string | null;
            completed_at: string | null;
            retry_count: number;
            metadata: Record<string, unknown>;
        }>;
        listByExecution: (executionId: string) => Promise<{
            id: string;
            execution_id: string;
            node_id: string;
            node_type: string;
            status: "pending" | "running" | "succeeded" | "failed" | "skipped";
            input: Record<string, unknown>;
            output: Record<string, unknown>;
            error: string | null;
            started_at: string | null;
            completed_at: string | null;
            retry_count: number;
            metadata: Record<string, unknown>;
        }[]>;
        updateStatus: (id: string, data: {
            status: "pending" | "running" | "succeeded" | "failed" | "skipped";
            started_at?: string;
            completed_at?: string;
            output?: Record<string, unknown>;
            error?: string;
            retry_count?: number;
            metadata?: Record<string, unknown>;
        }) => Promise<void>;
    };
    triggers: {
        create: (data: {
            id: string;
            workflow_id: string;
            trigger_type: "cron" | "webhook" | "event" | "manual";
            config: Record<string, unknown>;
        }) => Promise<{
            id: string;
            workflow_id: string;
            trigger_type: "cron" | "webhook" | "event" | "manual";
            config: Record<string, unknown>;
            enabled: boolean;
            created_at: string;
            updated_at: string;
        }>;
        getById: (id: string) => Promise<{
            id: string;
            workflow_id: string;
            trigger_type: "cron" | "webhook" | "event" | "manual";
            config: Record<string, unknown>;
            enabled: boolean;
            created_at: string;
            updated_at: string;
        } | null>;
        listByWorkflow: (workflowId: string) => Promise<{
            id: string;
            workflow_id: string;
            trigger_type: "cron" | "webhook" | "event" | "manual";
            config: Record<string, unknown>;
            enabled: boolean;
            created_at: string;
            updated_at: string;
        }[]>;
        listEnabled: () => Promise<{
            id: string;
            workflow_id: string;
            trigger_type: "cron" | "webhook" | "event" | "manual";
            config: Record<string, unknown>;
            enabled: boolean;
            created_at: string;
            updated_at: string;
        }[]>;
        update: (id: string, data: {
            config?: Record<string, unknown>;
            enabled?: boolean;
        }) => Promise<void>;
        delete: (id: string) => Promise<void>;
    };
    audit: {
        write: (event: {
            id: string;
            actor: string;
            action: string;
            resource_type: string;
            resource_id?: string;
            details?: Record<string, unknown>;
            ip_address?: string;
        }) => Promise<void>;
        list: (filter: {
            actor?: string;
            action?: string;
            resource_type?: string;
            resource_id?: string;
            after?: string;
            before?: string;
        }, pagination: PaginationParams) => Promise<{
            data: {
                id: string;
                timestamp: string;
                actor: string;
                action: string;
                resource_type: string;
                resource_id: string | null;
                details: Record<string, unknown>;
                ip_address: string | null;
            }[];
            total: number;
            page: number;
            per_page: number;
            total_pages: number;
        }>;
    };
    users: {
        create: (data: {
            id: string;
            username: string;
            password_hash: string;
            email: string;
            role?: "read" | "write" | "admin";
            display_name?: string;
        }) => Promise<{
            id: string;
            username: string;
            email: string;
            role: "read" | "write" | "admin";
            display_name: string;
            created_at: string;
            is_active: boolean;
        }>;
        getById: (id: string) => Promise<{
            id: string;
            username: string;
            email: string;
            role: "read" | "write" | "admin";
            password_hash: string;
            display_name: string;
            is_active: boolean;
            last_login_at: string | null;
        } | null>;
        getByUsername: (username: string) => Promise<{
            id: string;
            username: string;
            email: string;
            role: "read" | "write" | "admin";
            password_hash: string;
            display_name: string;
            is_active: boolean;
            last_login_at: string | null;
        } | null>;
        updateLastLogin: (id: string) => Promise<void>;
        list: () => Promise<{
            id: string;
            username: string;
            email: string;
            role: "read" | "write" | "admin";
            display_name: string;
            is_active: boolean;
            created_at: string;
            last_login_at: string | null;
        }[]>;
        updateRole: (id: string, role: "read" | "write" | "admin") => Promise<void>;
        deactivate: (id: string) => Promise<void>;
    };
    secrets: {
        create: (data: {
            id: string;
            name: string;
            encrypted_value: string;
            scope: "global" | "workflow" | "connector";
            scope_id?: string;
            created_by: string;
        }) => Promise<void>;
        getByName: (name: string, scope?: string, scopeId?: string) => Promise<{
            id: string;
            name: string;
            encrypted_value: string;
            scope: "global" | "workflow" | "connector";
            scope_id: string | null;
        } | null>;
        list: (scope?: string, scopeId?: string) => Promise<{
            id: string;
            name: string;
            scope: "global" | "workflow" | "connector";
            scope_id: string | null;
            created_at: string;
        }[]>;
        update: (id: string, encrypted_value: string) => Promise<void>;
        delete: (id: string) => Promise<void>;
    };
    egressPolicies: {
        create: (data: {
            id: string;
            name: string;
            rule_type: "allow" | "deny";
            target_type: "domain" | "ip_range" | "region";
            target_value: string;
            priority?: number;
        }) => Promise<void>;
        listEnabled: () => Promise<{
            id: string;
            name: string;
            rule_type: "allow" | "deny";
            target_type: "domain" | "ip_range" | "region";
            target_value: string;
            priority: number;
            enabled: boolean;
        }[]>;
        list: () => Promise<{
            id: string;
            name: string;
            rule_type: "allow" | "deny";
            target_type: "domain" | "ip_range" | "region";
            target_value: string;
            priority: number;
            enabled: boolean;
            created_at: string;
        }[]>;
        update: (id: string, data: {
            name?: string;
            rule_type?: "allow" | "deny";
            target_type?: "domain" | "ip_range" | "region";
            target_value?: string;
            priority?: number;
            enabled?: boolean;
        }) => Promise<void>;
        delete: (id: string) => Promise<void>;
    };
    connectors: {
        create: (data: {
            id: string;
            connector_type: "vault" | "desk" | "recap" | "generic";
            name: string;
            config: Record<string, unknown>;
        }) => Promise<{
            id: string;
            connector_type: "vault" | "desk" | "recap" | "generic";
            name: string;
            config: Record<string, unknown>;
            status: "connected" | "disconnected" | "error";
            last_health_check: string | null;
            created_at: string;
            updated_at: string;
        }>;
        getById: (id: string) => Promise<{
            id: string;
            connector_type: "vault" | "desk" | "recap" | "generic";
            name: string;
            config: Record<string, unknown>;
            status: "connected" | "disconnected" | "error";
            last_health_check: string | null;
            created_at: string;
            updated_at: string;
        } | null>;
        list: () => Promise<{
            id: string;
            connector_type: "vault" | "desk" | "recap" | "generic";
            name: string;
            config: Record<string, unknown>;
            status: "connected" | "disconnected" | "error";
            last_health_check: string | null;
            created_at: string;
            updated_at: string;
        }[]>;
        update: (id: string, data: {
            name?: string;
            config?: Record<string, unknown>;
            status?: "connected" | "disconnected" | "error";
            last_health_check?: string;
        }) => Promise<void>;
        delete: (id: string) => Promise<void>;
    };
}
export {};
//# sourceMappingURL=index.d.ts.map