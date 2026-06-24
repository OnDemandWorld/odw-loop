/**
 * Abstract StateStore interface — every CRUD operation every Loop module needs.
 * SQLite and PostgreSQL adapters both implement this contract.
 */

import type {
  Workflow,
  WorkflowDefinition,
  WorkflowDefinitionVersion,
  WorkflowExecution,
  NodeExecution,
  WorkflowTrigger,
  Connector,
} from '@loop/types';

// ─── Shared pagination / filtering ────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  per_page: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface WorkflowFilter {
  status?: 'draft' | 'active' | 'archived';
  tag?: string;
  search?: string;
  sort?: string; // e.g. "updated_at:desc"
}

export interface ExecutionFilter {
  workflow_id?: string;
  status?: string;
  trigger_type?: string;
  started_after?: string;
  started_before?: string;
}

// ─── StateStore interface ─────────────────────────────────────────────────────

export interface StateStore {
  /** Initialise connection / run migrations. */
  initialise(): Promise<void>;

  /** Tear down connection. */
  close(): Promise<void>;

  // ── Workflows ─────────────────────────────────────────────────────────────

  workflows: {
    create(data: {
      id: string;
      name: string;
      description: string;
      definition: WorkflowDefinition;
      created_by: string;
      tags?: string[];
    }): Promise<Workflow>;

    getById(id: string): Promise<Workflow | null>;

    list(
      filter: WorkflowFilter,
      pagination: PaginationParams,
    ): Promise<PaginatedResult<Workflow>>;

    update(
      id: string,
      data: {
        name?: string;
        description?: string;
        definition?: WorkflowDefinition;
        status?: 'draft' | 'active' | 'archived';
        tags?: string[];
        updated_by: string;
      },
    ): Promise<Workflow>;

    /** Soft-delete: set status = 'archived'. */
    archive(id: string): Promise<void>;

    /** Hard-delete (for tests / cleanup). */
    delete(id: string): Promise<void>;
  };

  // ── Workflow Definitions (version snapshots) ──────────────────────────────

  workflowDefinitions: {
    create(data: {
      id: string;
      workflow_id: string;
      version: number;
      definition: WorkflowDefinition;
      commit_hash: string;
      created_by: string;
      change_summary?: string;
    }): Promise<WorkflowDefinitionVersion>;

    listByWorkflow(workflowId: string): Promise<WorkflowDefinitionVersion[]>;

    getByWorkflowAndVersion(
      workflowId: string,
      version: number,
    ): Promise<WorkflowDefinitionVersion | null>;
  };

  // ── Executions ────────────────────────────────────────────────────────────

  executions: {
    create(data: {
      id: string;
      workflow_id: string;
      workflow_version: number;
      trigger_type: 'manual' | 'cron' | 'webhook' | 'event';
      trigger_payload?: Record<string, unknown>;
      initiated_by?: string;
    }): Promise<WorkflowExecution>;

    getById(id: string): Promise<WorkflowExecution | null>;

    list(
      filter: ExecutionFilter,
      pagination: PaginationParams,
    ): Promise<PaginatedResult<WorkflowExecution>>;

    updateStatus(
      id: string,
      data: {
        status: WorkflowExecution['status'];
        started_at?: string;
        completed_at?: string;
        duration_ms?: number;
        error?: string;
      },
    ): Promise<void>;

    findInterrupted(): Promise<WorkflowExecution[]>;
  };

  // ── Node Executions ───────────────────────────────────────────────────────

  nodeExecutions: {
    create(data: {
      id: string;
      execution_id: string;
      node_id: string;
      node_type: string;
      input?: Record<string, unknown>;
    }): Promise<NodeExecution>;

    listByExecution(executionId: string): Promise<NodeExecution[]>;

    updateStatus(
      id: string,
      data: {
        status: NodeExecution['status'];
        started_at?: string;
        completed_at?: string;
        output?: Record<string, unknown>;
        error?: string;
        retry_count?: number;
        metadata?: Record<string, unknown>;
      },
    ): Promise<void>;
  };

  // ── Triggers ──────────────────────────────────────────────────────────────

  triggers: {
    create(data: {
      id: string;
      workflow_id: string;
      trigger_type: 'cron' | 'webhook' | 'event' | 'manual';
      config: Record<string, unknown>;
    }): Promise<WorkflowTrigger>;

    getById(id: string): Promise<WorkflowTrigger | null>;

    listByWorkflow(workflowId: string): Promise<WorkflowTrigger[]>;

    listEnabled(): Promise<WorkflowTrigger[]>;

    update(
      id: string,
      data: { config?: Record<string, unknown>; enabled?: boolean },
    ): Promise<void>;

    delete(id: string): Promise<void>;
  };

  // ── Audit (append-only) ───────────────────────────────────────────────────

  audit: {
    write(event: {
      id: string;
      actor: string;
      action: string;
      resource_type: string;
      resource_id?: string;
      details?: Record<string, unknown>;
      ip_address?: string;
    }): Promise<void>;

    list(filter: {
      actor?: string;
      action?: string;
      resource_type?: string;
      resource_id?: string;
      after?: string;
      before?: string;
    }, pagination: PaginationParams): Promise<PaginatedResult<{
      id: string;
      timestamp: string;
      actor: string;
      action: string;
      resource_type: string;
      resource_id: string | null;
      details: Record<string, unknown>;
      ip_address: string | null;
    }>>;
  };

  // ── Users ─────────────────────────────────────────────────────────────────

  users: {
    create(data: {
      id: string;
      username: string;
      password_hash: string;
      email: string;
      role?: 'read' | 'write' | 'admin';
      display_name?: string;
    }): Promise<{
      id: string;
      username: string;
      email: string;
      role: string;
      display_name: string;
      created_at: string;
      is_active: boolean;
    }>;

    getById(id: string): Promise<{
      id: string;
      username: string;
      email: string;
      role: string;
      password_hash: string;
      display_name: string;
      is_active: boolean;
      last_login_at: string | null;
    } | null>;

    getByUsername(username: string): Promise<{
      id: string;
      username: string;
      email: string;
      role: string;
      password_hash: string;
      display_name: string;
      is_active: boolean;
      last_login_at: string | null;
    } | null>;

    updateLastLogin(id: string): Promise<void>;

    list(): Promise<Array<{
      id: string;
      username: string;
      email: string;
      role: string;
      display_name: string;
      is_active: boolean;
      created_at: string;
      last_login_at: string | null;
    }>>;

    updateRole(id: string, role: 'read' | 'write' | 'admin'): Promise<void>;

    deactivate(id: string): Promise<void>;
  };

  // ── Secrets ───────────────────────────────────────────────────────────────

  secrets: {
    create(data: {
      id: string;
      name: string;
      encrypted_value: string;
      scope: 'global' | 'workflow' | 'connector';
      scope_id?: string;
      created_by: string;
    }): Promise<void>;

    getByName(name: string, scope?: string, scopeId?: string): Promise<{
      id: string;
      name: string;
      encrypted_value: string;
      scope: string;
      scope_id: string | null;
    } | null>;

    list(scope?: string, scopeId?: string): Promise<Array<{
      id: string;
      name: string;
      scope: string;
      scope_id: string | null;
      created_at: string;
    }>>;

    update(id: string, encrypted_value: string): Promise<void>;

    delete(id: string): Promise<void>;
  };

  // ── Egress Policies ───────────────────────────────────────────────────────

  egressPolicies: {
    create(data: {
      id: string;
      name: string;
      rule_type: 'allow' | 'deny';
      target_type: 'domain' | 'ip_range' | 'region';
      target_value: string;
      priority?: number;
    }): Promise<void>;

    listEnabled(): Promise<Array<{
      id: string;
      name: string;
      rule_type: 'allow' | 'deny';
      target_type: 'domain' | 'ip_range' | 'region';
      target_value: string;
      priority: number;
      enabled: boolean;
    }>>;

    list(): Promise<Array<{
      id: string;
      name: string;
      rule_type: 'allow' | 'deny';
      target_type: 'domain' | 'ip_range' | 'region';
      target_value: string;
      priority: number;
      enabled: boolean;
      created_at: string;
    }>>;

    update(
      id: string,
      data: {
        name?: string;
        rule_type?: 'allow' | 'deny';
        target_type?: 'domain' | 'ip_range' | 'region';
        target_value?: string;
        priority?: number;
        enabled?: boolean;
      },
    ): Promise<void>;

    delete(id: string): Promise<void>;
  };

  // ── Connectors ────────────────────────────────────────────────────────────

  connectors: {
    create(data: {
      id: string;
      connector_type: Connector['connector_type'];
      name: string;
      config: Record<string, unknown>;
    }): Promise<Connector>;

    getById(id: string): Promise<Connector | null>;

    list(): Promise<Connector[]>;

    update(
      id: string,
      data: {
        name?: string;
        config?: Record<string, unknown>;
        status?: 'connected' | 'disconnected' | 'error';
        last_health_check?: string;
      },
    ): Promise<void>;

    delete(id: string): Promise<void>;
  };
}
