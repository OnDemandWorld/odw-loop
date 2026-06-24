export interface Migration {
  version: string;
  name: string;
  sql: string;
}

/** PostgreSQL-specific migrations (uses JSONB, GIN indexes, etc.) */
export const MIGRATIONS_PG: Migration[] = [
  {
    version: '001',
    name: 'initial_schema_pg',
    sql: `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'read' CHECK(role IN ('read','write','admin')),
  display_name VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  tags JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflows_status_updated ON workflows(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_created_by ON workflows(created_by);
CREATE INDEX IF NOT EXISTS idx_workflows_tags ON workflows USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_workflows_name_fts ON workflows USING GIN (to_tsvector('english', name || ' ' || description));

-- Workflow definitions (version snapshots)
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  version INTEGER NOT NULL,
  definition JSONB NOT NULL,
  commit_hash VARCHAR(40) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  change_summary TEXT NOT NULL DEFAULT '',
  UNIQUE(workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_wf_defs_workflow ON workflow_definitions(workflow_id, version DESC);

-- Workflow executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  workflow_version INTEGER NOT NULL,
  trigger_type VARCHAR(20) NOT NULL CHECK(trigger_type IN ('manual','cron','webhook','event')),
  trigger_payload JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled','paused')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  initiated_by UUID
);
CREATE INDEX IF NOT EXISTS idx_exec_workflow_started ON workflow_executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_status_started ON workflow_executions(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_started ON workflow_executions(started_at DESC);

-- Node executions
CREATE TABLE IF NOT EXISTS node_executions (
  id UUID PRIMARY KEY,
  execution_id UUID NOT NULL REFERENCES workflow_executions(id),
  node_id VARCHAR(100) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending','running','succeeded','failed','skipped')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_node_exec_execution ON node_executions(execution_id, started_at);
CREATE INDEX IF NOT EXISTS idx_node_exec_node ON node_executions(execution_id, node_id);

-- Workflow triggers
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  trigger_type VARCHAR(20) NOT NULL CHECK(trigger_type IN ('cron','webhook','event','manual')),
  config JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Audit events (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  actor VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);

-- Secrets
CREATE TABLE IF NOT EXISTS secrets (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  encrypted_value BYTEA NOT NULL,
  scope VARCHAR(50) NOT NULL CHECK(scope IN ('global','workflow','connector')),
  scope_id UUID,
  created_by UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Egress policies
CREATE TABLE IF NOT EXISTS egress_policies (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(20) NOT NULL CHECK(rule_type IN ('allow','deny')),
  target_type VARCHAR(20) NOT NULL CHECK(target_type IN ('domain','ip_range','region')),
  target_value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Connectors
CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY,
  connector_type VARCHAR(50) NOT NULL CHECK(connector_type IN ('vault','desk','recap','generic')),
  name VARCHAR(100) NOT NULL,
  config JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error')),
  last_health_check TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`,
  },
];
