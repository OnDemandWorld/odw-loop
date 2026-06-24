/**
 * Drizzle schema for Loop — matches TSD §4 exactly.
 * Works with both SQLite (Core) and PostgreSQL (Scale) via Drizzle's dialect abstraction.
 */
import { real } from 'drizzle-orm/sqlite-core';
export declare const users: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "users";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        username: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "username";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        password_hash: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "password_hash";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        email: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "email";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        role: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "role";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: "read" | "write" | "admin";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["read", "write", "admin"];
            baseColumn: never;
        }, object>;
        display_name: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "display_name";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        last_login_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "last_login_at";
            tableName: "users";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        is_active: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "is_active";
            tableName: "users";
            dataType: "boolean";
            columnType: "SQLiteBoolean";
            data: boolean;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const workflows: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "workflows";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        name: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "name";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        description: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "description";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        definition: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "definition";
            tableName: "workflows";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        version: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "version";
            tableName: "workflows";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        status: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "status";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: "draft" | "active" | "archived";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["draft", "active", "archived"];
            baseColumn: never;
        }, object>;
        tags: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "tags";
            tableName: "workflows";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        created_by: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_by";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        updated_by: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "updated_by";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        updated_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "updated_at";
            tableName: "workflows";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const workflowDefinitions: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "workflow_definitions";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        workflow_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "workflow_id";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        version: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "version";
            tableName: "workflow_definitions";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        definition: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "definition";
            tableName: "workflow_definitions";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        commit_hash: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "commit_hash";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_by: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_by";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        change_summary: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "change_summary";
            tableName: "workflow_definitions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const workflowExecutions: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "workflow_executions";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        workflow_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "workflow_id";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        workflow_version: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "workflow_version";
            tableName: "workflow_executions";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        trigger_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "trigger_type";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: "manual" | "cron" | "webhook" | "event";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["manual", "cron", "webhook", "event"];
            baseColumn: never;
        }, object>;
        trigger_payload: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "trigger_payload";
            tableName: "workflow_executions";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        status: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "status";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "paused";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["pending", "running", "succeeded", "failed", "cancelled", "paused"];
            baseColumn: never;
        }, object>;
        started_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "started_at";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        completed_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "completed_at";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        duration_ms: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "duration_ms";
            tableName: "workflow_executions";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: false;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        error: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "error";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        initiated_by: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "initiated_by";
            tableName: "workflow_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const nodeExecutions: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "node_executions";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        execution_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "execution_id";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        node_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "node_id";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        node_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "node_type";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        status: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "status";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: "pending" | "running" | "succeeded" | "failed" | "skipped";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["pending", "running", "succeeded", "failed", "skipped"];
            baseColumn: never;
        }, object>;
        input: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "input";
            tableName: "node_executions";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        output: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "output";
            tableName: "node_executions";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        error: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "error";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        started_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "started_at";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        completed_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "completed_at";
            tableName: "node_executions";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        retry_count: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "retry_count";
            tableName: "node_executions";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        metadata: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "metadata";
            tableName: "node_executions";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const workflowTriggers: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "workflow_triggers";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "workflow_triggers";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        workflow_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "workflow_id";
            tableName: "workflow_triggers";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        trigger_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "trigger_type";
            tableName: "workflow_triggers";
            dataType: "string";
            columnType: "SQLiteText";
            data: "manual" | "cron" | "webhook" | "event";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["cron", "webhook", "event", "manual"];
            baseColumn: never;
        }, object>;
        config: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "config";
            tableName: "workflow_triggers";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        enabled: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "enabled";
            tableName: "workflow_triggers";
            dataType: "boolean";
            columnType: "SQLiteBoolean";
            data: boolean;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "workflow_triggers";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        updated_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "updated_at";
            tableName: "workflow_triggers";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const auditEvents: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "audit_events";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "timestamp";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        actor: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "actor";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        action: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "action";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        resource_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "resource_type";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        resource_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "resource_id";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        details: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "details";
            tableName: "audit_events";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        ip_address: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "ip_address";
            tableName: "audit_events";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const secrets: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "secrets";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        name: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "name";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        encrypted_value: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "encrypted_value";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        scope: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "scope";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: "global" | "workflow" | "connector";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["global", "workflow", "connector"];
            baseColumn: never;
        }, object>;
        scope_id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "scope_id";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_by: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_by";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        updated_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "updated_at";
            tableName: "secrets";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const egressPolicies: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "egress_policies";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        name: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "name";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        rule_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "rule_type";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: "allow" | "deny";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["allow", "deny"];
            baseColumn: never;
        }, object>;
        target_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "target_type";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: "domain" | "ip_range" | "region";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["domain", "ip_range", "region"];
            baseColumn: never;
        }, object>;
        target_value: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "target_value";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        priority: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "priority";
            tableName: "egress_policies";
            dataType: "number";
            columnType: "SQLiteInteger";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        enabled: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "enabled";
            tableName: "egress_policies";
            dataType: "boolean";
            columnType: "SQLiteBoolean";
            data: boolean;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "egress_policies";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const connectors: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "connectors";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "id";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        connector_type: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "connector_type";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: "vault" | "desk" | "recap" | "generic";
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: ["vault", "desk", "recap", "generic"];
            baseColumn: never;
        }, object>;
        name: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "name";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        config: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "config";
            tableName: "connectors";
            dataType: "json";
            columnType: "SQLiteTextJson";
            data: unknown;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: undefined;
            baseColumn: never;
        }, object>;
        status: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "status";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: "error" | "connected" | "disconnected";
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: ["connected", "disconnected", "error"];
            baseColumn: never;
        }, object>;
        last_health_check: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "last_health_check";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        created_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "created_at";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        updated_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "updated_at";
            tableName: "connectors";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export declare const schemaMigrations: import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{
    name: "schema_migrations";
    schema: undefined;
    columns: {
        version: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "version";
            tableName: "schema_migrations";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        applied_at: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "applied_at";
            tableName: "schema_migrations";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
        checksum: import("drizzle-orm/sqlite-core").SQLiteColumn<{
            name: "checksum";
            tableName: "schema_migrations";
            dataType: "string";
            columnType: "SQLiteText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
        }, object>;
    };
    dialect: "sqlite";
}>;
export { real };
//# sourceMappingURL=schema.d.ts.map