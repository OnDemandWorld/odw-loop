/** All migrations in chronological order. */
export const MIGRATIONS = [
    {
        version: '001',
        name: 'initial_schema',
        sql: `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'read' CHECK(role IN ('read','write','admin')),
  display_name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  last_login_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  tags TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_workflows_status_updated ON workflows(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_created_by ON workflows(created_by);

-- Workflow definitions (version snapshots)
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  change_summary TEXT NOT NULL DEFAULT '',
  UNIQUE(workflow_id, version)
);
CREATE INDEX IF NOT EXISTS idx_wf_defs_workflow ON workflow_definitions(workflow_id, version DESC);

-- Workflow executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  workflow_version INTEGER NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','cron','webhook','event')),
  trigger_payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled','paused')),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  initiated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_exec_workflow_started ON workflow_executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_status_started ON workflow_executions(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_started ON workflow_executions(started_at DESC);

-- Node executions
CREATE TABLE IF NOT EXISTS node_executions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES workflow_executions(id),
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','skipped')),
  input TEXT NOT NULL DEFAULT '{}',
  output TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_node_exec_execution ON node_executions(execution_id, started_at);
CREATE INDEX IF NOT EXISTS idx_node_exec_node ON node_executions(execution_id, node_id);

-- Workflow triggers
CREATE TABLE IF NOT EXISTS workflow_triggers (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','webhook','event','manual')),
  config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Audit events (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);

-- Secrets
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global','workflow','connector')),
  scope_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Egress policies
CREATE TABLE IF NOT EXISTS egress_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('allow','deny')),
  target_type TEXT NOT NULL CHECK(target_type IN ('domain','ip_range','region')),
  target_value TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Connectors
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  connector_type TEXT NOT NULL CHECK(connector_type IN ('vault','desk','recap','generic')),
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connected','disconnected','error')),
  last_health_check TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Schema migrations (bootstrap — created outside Drizzle in migrate.ts)
`,
    },
];
//# sourceMappingURL=index.js.map