# Loop — Technical Specification Document (TSD)

**Product:** Loop (ODW.ai Suite)
**Version:** 1.0
**Status:** Final Draft
**Last Updated:** 2026-06-23
**Author:** Architecture Team, ODW.ai
**Classification:** Internal — Implementation-Ready

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Service & Module Breakdown](#2-service--module-breakdown)
3. [Technical Stack Specification](#3-technical-stack-specification)
4. [Data Modeling & Schema Definitions](#4-data-modeling--schema-definitions)
5. [API Contracts (Strict Specification)](#5-api-contracts-strict-specification)
6. [Business Logic Specification](#6-business-logic-specification)
7. [State Management & Data Flow](#7-state-management--data-flow)
8. [Background Jobs & Asynchronous Processing](#8-background-jobs--asynchronous-processing)
9. [External Integrations](#9-external-integrations)
10. [Configuration & Environment Variables](#10-configuration--environment-variables)
11. [Security Implementation Details](#11-security-implementation-details)
12. [Error Handling & Logging](#12-error-handling--logging)
13. [Performance Considerations](#13-performance-considerations)
14. [Testing Strategy](#14-testing-strategy)
15. [Deployment & Build Instructions](#15-deployment--build-instructions)
16. [Observability Hooks](#16-observability-hooks)
17. [File & Folder Structure](#17-file--folder-structure)
18. [Coding Standards & Conventions](#18-coding-standards--conventions)
19. [Assumptions & Constraints](#19-assumptions--constraints)

---

## 1. System Overview

### 1.1 Purpose

Loop is the orchestration layer of the ODW.ai sovereign agent suite. It connects ODW's individual agents — Vault (knowledge base), Desk (workspace/productivity), Recap (meeting intelligence), and future modules — into automated, multi-step workflows that execute entirely on the customer's own infrastructure.

**Core functionality:**
- Visual drag-and-drop workflow authoring (node-and-edge canvas)
- Event-driven execution engine with topological DAG scheduling
- Native integration with ODW agent primitives as typed workflow objects
- Self-hosted, model-agnostic, air-gapped capable
- Open-core economics: free Core tier (single-instance) + paid Scale tier (multi-instance, HA)

### 1.2 High-Level Architecture → Concrete Services

| Architecture Component (from SAD) | Concrete Service/Module |
|-----------------------------------|------------------------|
| Loop Canvas (Frontend) | `loop-canvas` — React 18 SPA |
| API Gateway | `loop-api` — Fastify HTTP/WS server |
| Workflow Authoring Service | `@loop/workflow-authoring` — internal module |
| Versioning Service | `@loop/versioning` — internal module (libgit2) |
| Execution Engine | `@loop/engine` — internal module (Core: in-process; Scale: distributed) |
| Trigger Dispatcher | `@loop/triggers` — internal module |
| Connector Registry & Adapter Layer | `@loop/connectors` — internal module + per-connector packages |
| Code Node Sandbox | `loop-sandbox` — separate container (gVisor/Firecracker) |
| Semantic Type System | `@loop/types` — shared TypeScript library |
| State Store | `@loop/state` — internal module (SQLite/PostgreSQL adapter) |
| Secrets Manager | `@loop/secrets` — internal module |
| Egress Policy Engine | `@loop/egress` — internal module (network interceptor) |
| Observability Service | `@loop/observability` — internal module |
| Control Plane (Scale) | `loop-control-plane` — separate service |

### 1.3 System Boundaries

**Included:**
- Workflow authoring, versioning, execution, and monitoring
- Native ODW agent connectors (Vault, Desk, Recap, generic agent)
- Code Node sandbox execution
- Event-driven and scheduled triggers
- RBAC, encryption, egress policy enforcement
- Core tier: single-instance Docker Compose deployment
- Scale tier: multi-instance Kubernetes with control plane

**Excluded:**
- ODW agent internals (Vault, Desk, Recap are separate products)
- Managed SaaS hosting (ODW.ai does not operate Loop)
- Mobile app (deferred to post-v1.0)
- Real-time collaborative editing (deferred to v1.2)
- Natural-language workflow generation (deferred to v1.1)
- Workflow marketplace (deferred to v1.2)
- Cross-organization federation (deferred to v2.0)

---

## 2. Service & Module Breakdown

### 2.1 `loop-canvas` (Frontend)

- **Responsibility:** Visual workflow builder, execution monitoring dashboard, admin settings UI, data flow visualization
- **Inputs:** Workflow definitions (JSON), execution state (WebSocket), configuration data
- **Outputs:** User actions (node placement, edge creation, config changes), rendered visualizations
- **Sub-components:**
  - `CanvasEditor` — React Flow-based node-and-edge canvas
  - `NodeLibrary` — searchable, categorized node palette
  - `NodeConfigPanel` — per-node configuration form
  - `ExecutionMonitor` — real-time execution progress view
  - `MetricsDashboard` — success rate, latency, throughput charts
  - `AdminPanel` — RBAC, secrets, egress policy, system config
  - `DataFlowMap` — visual graph of external endpoints contacted
- **Dependencies:** `loop-api` (REST + WebSocket)
- **Deployment unit:** Static assets served by `loop-api` (embedded) or separate nginx container

### 2.2 `loop-api` (API Gateway + Monolith Host)

- **Responsibility:** Single entry point for all client requests. Authentication, rate limiting, request routing, RBAC enforcement. Hosts all internal modules in the Core tier modular monolith.
- **Inputs:** HTTP/WebSocket requests from `loop-canvas` and external API consumers
- **Outputs:** Authenticated responses; routed internal service calls
- **Sub-components:**
  - `AuthMiddleware` — JWT validation, API key auth
  - `RateLimiter` — token bucket per user/endpoint
  - `Router` — REST endpoint dispatch
  - `WebSocketServer` — real-time execution updates
  - `@loop/workflow-authoring` — workflow CRUD, topology validation
  - `@loop/versioning` — git-backed version history
  - `@loop/engine` — execution engine (Core: in-process)
  - `@loop/triggers` — trigger registration and dispatch
  - `@loop/connectors` — connector registry and adapter dispatch
  - `@loop/types` — semantic type system
  - `@loop/state` — state store abstraction
  - `@loop/secrets` — encrypted credential storage
  - `@loop/egress` — network egress policy enforcement
  - `@loop/observability` — metrics, logs, alerting
- **Dependencies:** SQLite (Core) or PostgreSQL+Redis (Scale), ODW agent APIs, LLM providers
- **Deployment unit:** Single container (`loop-app`) in Core; multiple pods in Scale

### 2.3 `loop-sandbox` (Code Node Runtime)

- **Responsibility:** Execute user-written Python/TypeScript code in isolated environment with resource limits and network restrictions
- **Inputs:** User code, typed input data, allowed network endpoints, resource limits
- **Outputs:** Typed output data, stdout/stderr logs, error information
- **Sub-components:**
  - `SandboxManager` — pool management, lifecycle
  - `PythonRuntime` — Python 3.11+ execution environment
  - `NodeRuntime` — Node.js execution environment
  - `NetworkPolicy` — egress whitelist enforcement
  - `ResourceLimiter` — CPU time, memory caps
- **Dependencies:** gVisor or Firecracker (host-level), `loop-api` (sandbox API over gRPC/Unix socket)
- **Deployment unit:** Separate container with gVisor runtime; DaemonSet or pool in Scale

### 2.4 `loop-control-plane` (Scale Tier Only)

- **Responsibility:** Unified dashboard for managing multiple Loop instances. Fleet-wide deployment, monitoring, configuration. Cross-region data residency enforcement. Failover coordination.
- **Inputs:** Status reports from regional Loop instances, admin commands
- **Outputs:** Deployment directives, failover commands, aggregated fleet metrics
- **Sub-components:**
  - `FleetManager` — instance registration, health monitoring
  - `DeploymentCoordinator` — workflow distribution across instances
  - `ResidencyEnforcer` — cross-region data residency rules
  - `FailoverManager` — active-active/active-passive coordination
- **Dependencies:** PostgreSQL (fleet state), regional `loop-api` instances (WebSocket + REST)
- **Deployment unit:** Separate container/pod (`loop-control-plane`)

---

## 3. Technical Stack Specification

### 3.1 Backend

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Language | TypeScript | 5.3+ | Type safety, shared types with frontend, mature ecosystem |
| Runtime | Node.js | 20 LTS | Performance, async I/O, ecosystem |
| Framework | Fastify | 4.x | High-performance HTTP, schema-based validation, plugin system |
| ORM/DB Access | Drizzle ORM | 0.29+ | Type-safe SQL, lightweight, supports SQLite + PostgreSQL |
| Validation | Zod | 3.22+ | Runtime type validation, schema inference, composable |
| Logging | Pino | 8.x | High-performance structured JSON logging |
| Auth | jose | 5.x | JWT/JWS/JWE for token handling |
| Scheduling | node-cron | 3.x | Cron expression parsing and scheduling |
| Git | isomorphic-git | 1.x | Pure JS git implementation (no system git dependency) |
| Testing | Vitest | 1.x | Fast, TypeScript-native, compatible with Jest API |
| HTTP Client | undici | 6.x | Built-in Node.js HTTP client, high performance |
| WebSocket | ws | 8.x | Lightweight WebSocket server |
| Serialization | msgpackr | 1.x | Efficient binary serialization for internal communication |
| Encryption | Node.js crypto (built-in) | — | AES-256-GCM for at-rest encryption |

### 3.2 Frontend

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Language | TypeScript | 5.3+ | Type safety |
| Framework | React | 18.x | Component model, ecosystem |
| Canvas Library | React Flow | 11.x | Node-and-edge canvas, customizable nodes/edges |
| State Management | Zustand | 4.x | Lightweight, no boilerplate, TypeScript-friendly |
| Styling | Tailwind CSS | 3.x | Utility-first, consistent design system |
| Forms | React Hook Form + Zod | — | Form validation with shared schemas |
| HTTP Client | ky | 1.x | Tiny, fetch-based, interceptors |
| Charts | Recharts | 2.x | React-native charting |
| i18n | react-i18next | 13.x | Internationalization (5 languages at launch) |
| Build Tool | Vite | 5.x | Fast HMR, optimized builds |

### 3.3 AI/ML Stack

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Local Inference | Ollama API, vLLM API, llama.cpp server | Model-agnostic provider interface |
| Remote Providers | OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, Google Vertex | Provider abstraction layer |
| Embedding Models | Provider-agnostic (configured per deployment) | Used by Vault connector for RAG |
| Prompt Management | Template engine with variable interpolation | Reusable prompts across workflows |
| Model Selection | Configurable per-workflow, per-node | Right-size inference cost |

### 3.4 Data Layer

| Component | Core Tier | Scale Tier |
|-----------|-----------|------------|
| Primary Store | SQLite 3.45+ (WAL mode) | PostgreSQL 16+ |
| Cache/Queue | In-memory (Node.js) | Redis 7+ (Streams for execution dispatch) |
| Versioning | isomorphic-git (bare repo on disk) | isomorphic-git (bare repo on shared volume) |
| File Storage | Local filesystem (execution logs) | S3-compatible or NFS (execution logs) |

### 3.5 DevOps Tooling

| Tool | Purpose |
|------|---------|
| Docker | Containerization |
| Docker Compose | Core tier orchestration |
| Kubernetes + Helm | Scale tier orchestration |
| GitHub Actions | CI/CD pipeline |
| gVisor / Firecracker | Code Node sandboxing |
| Prometheus + Grafana | Metrics collection and dashboards |
| OpenTelemetry SDK | Distributed tracing (Scale tier) |

---

## 4. Data Modeling & Schema Definitions

### 4.1 Entity: `workflows`

**Table Name:** `workflows`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, NOT NULL | Unique workflow identifier |
| `name` | VARCHAR(255) | NOT NULL | Human-readable name |
| `description` | TEXT | DEFAULT '' | Workflow description |
| `definition` | JSONB | NOT NULL | Node graph definition (JSON) |
| `version` | INTEGER | NOT NULL, DEFAULT 1 | Auto-incrementing version number |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'draft' | Enum: draft, active, archived |
| `tags` | JSONB | DEFAULT '[]' | Array of string tags |
| `created_by` | UUID | NOT NULL, FK → users.id | Creator |
| `updated_by` | UUID | NOT NULL, FK → users.id | Last modifier |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Last modification timestamp |

**Indexes:**
- `idx_workflows_status_updated` ON (status, updated_at DESC)
- `idx_workflows_created_by` ON (created_by)
- `idx_workflows_tags` USING GIN ON (tags)
- `idx_workflows_name_fts` USING GIN (to_tsvector('english', name || ' ' || description))

**Relationships:**
- One-to-many: `workflows` → `workflow_executions`
- One-to-many: `workflows` → `workflow_triggers`

**Example Record:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Meeting → Tasks → KB",
  "description": "Extracts action items from meeting transcripts, creates Desk tasks, and stores summaries in Vault",
  "definition": { "nodes": [...], "edges": [...] },
  "version": 3,
  "status": "active",
  "tags": ["meetings", "productivity"],
  "created_by": "user-001",
  "updated_by": "user-001",
  "created_at": "2026-06-01T10:00:00Z",
  "updated_at": "2026-06-20T14:30:00Z"
}
```

### 4.2 Entity: `workflow_definitions` (Versioned Snapshots)

**Table Name:** `workflow_definitions`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique snapshot ID |
| `workflow_id` | UUID | NOT NULL, FK → workflows.id | Parent workflow |
| `version` | INTEGER | NOT NULL | Version number |
| `definition` | JSONB | NOT NULL | Full node graph at this version |
| `commit_hash` | VARCHAR(40) | NOT NULL | Git commit hash |
| `created_by` | UUID | NOT NULL, FK → users.id | Author |
| `created_at` | TIMESTAMP | NOT NULL | Timestamp |
| `change_summary` | TEXT | DEFAULT '' | Human-readable change description |

**Indexes:**
- `UNIQUE(workflow_id, version)`
- `idx_wf_defs_workflow` ON (workflow_id, version DESC)

### 4.3 Entity: `workflow_executions`

**Table Name:** `workflow_executions`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Execution ID |
| `workflow_id` | UUID | NOT NULL, FK → workflows.id | Workflow being executed |
| `workflow_version` | INTEGER | NOT NULL | Version at execution time |
| `trigger_type` | VARCHAR(20) | NOT NULL | Enum: manual, cron, webhook, event |
| `trigger_payload` | JSONB | DEFAULT '{}' | Trigger input data |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'pending' | Enum: pending, running, succeeded, failed, cancelled, paused |
| `started_at` | TIMESTAMP | NULLABLE | When execution started |
| `completed_at` | TIMESTAMP | NULLABLE | When execution finished |
| `duration_ms` | INTEGER | NULLABLE | Total duration in milliseconds |
| `error` | TEXT | NULLABLE | Error message if failed |
| `initiated_by` | UUID | NULLABLE, FK → users.id | User who triggered (null for system triggers) |

**Indexes:**
- `idx_exec_workflow_started` ON (workflow_id, started_at DESC)
- `idx_exec_status_started` ON (status, started_at DESC)
- `idx_exec_started` ON (started_at DESC)

**Relationships:**
- Many-to-one: `workflow_executions` → `workflows`
- One-to-many: `workflow_executions` → `node_executions`

### 4.4 Entity: `node_executions`

**Table Name:** `node_executions`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Node execution ID |
| `execution_id` | UUID | NOT NULL, FK → workflow_executions.id | Parent execution |
| `node_id` | VARCHAR(100) | NOT NULL | Node ID within workflow definition |
| `node_type` | VARCHAR(50) | NOT NULL | Connector/node type identifier |
| `status` | VARCHAR(20) | NOT NULL | Enum: pending, running, succeeded, failed, skipped |
| `input` | JSONB | DEFAULT '{}' | Input data (encrypted at rest) |
| `output` | JSONB | DEFAULT '{}' | Output data (encrypted at rest) |
| `error` | TEXT | NULLABLE | Error message |
| `started_at` | TIMESTAMP | NULLABLE | Node start time |
| `completed_at` | TIMESTAMP | NULLABLE | Node completion time |
| `retry_count` | INTEGER | DEFAULT 0 | Number of retries attempted |
| `metadata` | JSONB | DEFAULT '{}' | Additional metadata (timing, connector info) |

**Indexes:**
- `idx_node_exec_execution` ON (execution_id, started_at)
- `idx_node_exec_node` ON (execution_id, node_id)

### 4.5 Entity: `workflow_triggers`

**Table Name:** `workflow_triggers`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Trigger ID |
| `workflow_id` | UUID | NOT NULL, FK → workflows.id | Associated workflow |
| `trigger_type` | VARCHAR(20) | NOT NULL | Enum: cron, webhook, event, manual |
| `config` | JSONB | NOT NULL | Trigger-specific configuration |
| `enabled` | BOOLEAN | DEFAULT true | Whether trigger is active |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL | Last update timestamp |

**Config schemas by type:**
- `cron`: `{ "expression": "0 6 * * *", "timezone": "UTC" }`
- `webhook`: `{ "path": "/hooks/abc123", "secret": "hmac-secret", "method": "POST" }`
- `event`: `{ "source": "recap", "event_type": "transcript.completed", "filter": {} }`
- `manual`: `{}` (no config needed)

### 4.6 Entity: `audit_events`

**Table Name:** `audit_events`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Event ID |
| `timestamp` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Event timestamp |
| `actor` | VARCHAR(100) | NOT NULL | User ID or 'system' |
| `action` | VARCHAR(100) | NOT NULL | Action identifier (e.g., 'workflow.created') |
| `resource_type` | VARCHAR(50) | NOT NULL | Type of affected resource |
| `resource_id` | UUID | NULLABLE | ID of affected resource |
| `details` | JSONB | DEFAULT '{}' | Additional context |
| `ip_address` | VARCHAR(45) | NULLABLE | Client IP address |

**Indexes:**
- `idx_audit_timestamp` ON (timestamp DESC)
- `idx_audit_resource` ON (resource_type, resource_id)
- `idx_audit_actor` ON (actor)

**Note:** Append-only. No UPDATE or DELETE operations permitted.

### 4.7 Entity: `users`

**Table Name:** `users`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | User ID |
| `username` | VARCHAR(100) | UNIQUE, NOT NULL | Login username |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt hash |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | Email address |
| `role` | VARCHAR(20) | NOT NULL, DEFAULT 'read' | Enum: read, write, admin |
| `display_name` | VARCHAR(255) | DEFAULT '' | Human-readable name |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |
| `last_login_at` | TIMESTAMP | NULLABLE | Last login timestamp |
| `is_active` | BOOLEAN | DEFAULT true | Account status |

### 4.8 Entity: `secrets`

**Table Name:** `secrets`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Secret ID |
| `name` | VARCHAR(100) | UNIQUE, NOT NULL | Human-readable name |
| `encrypted_value` | BYTEA | NOT NULL | AES-256-GCM encrypted value |
| `scope` | VARCHAR(50) | NOT NULL | Enum: global, workflow, connector |
| `scope_id` | UUID | NULLABLE | Workflow ID or connector ID if scoped |
| `created_by` | UUID | NOT NULL | Creator |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL | Last update |

### 4.9 Entity: `egress_policies`

**Table Name:** `egress_policies`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Policy ID |
| `name` | VARCHAR(100) | NOT NULL | Policy name |
| `rule_type` | VARCHAR(20) | NOT NULL | Enum: allow, deny |
| `target_type` | VARCHAR(20) | NOT NULL | Enum: domain, ip_range, region |
| `target_value` | TEXT | NOT NULL | Domain pattern, CIDR, or region code |
| `priority` | INTEGER | NOT NULL, DEFAULT 0 | Higher = evaluated first |
| `enabled` | BOOLEAN | DEFAULT true | Active status |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |

### 4.10 Entity: `connectors`

**Table Name:** `connectors`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Connector instance ID |
| `connector_type` | VARCHAR(50) | NOT NULL | Enum: vault, desk, recap, generic, premium_* |
| `name` | VARCHAR(100) | NOT NULL | Display name |
| `config` | JSONB | NOT NULL | Connection configuration (encrypted fields) |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'disconnected' | Enum: connected, disconnected, error |
| `last_health_check` | TIMESTAMP | NULLABLE | Last successful health check |
| `created_at` | TIMESTAMP | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMP | NOT NULL | Last update |

### 4.11 Workflow Definition Schema (JSON)

```json
{
  "version": "1.0",
  "nodes": [
    {
      "id": "node_1",
      "type": "recap.extract_action_items",
      "position": { "x": 100, "y": 200 },
      "config": {
        "transcript_id": "{{trigger.payload.transcript_id}}",
        "model": "llama-3-70b"
      },
      "retry": { "max_attempts": 3, "backoff": "exponential", "initial_delay_ms": 1000 },
      "timeout_ms": 30000,
      "input_schema": { "transcript_id": "string" },
      "output_schema": { "action_items": "ActionItem[]" }
    },
    {
      "id": "node_2",
      "type": "control.branch",
      "position": { "x": 300, "y": 200 },
      "config": {
        "condition": "{{node_1.output.action_items.length}} > 0",
        "branches": [
          { "id": "has_items", "condition": "true" },
          { "id": "no_items", "condition": "false" }
        ]
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "source_port": "output",
      "target": "node_2",
      "target_port": "input",
      "type_compatibility": true
    }
  ],
  "variables": {
    "client_folder_id": { "type": "string", "default": "" }
  },
  "metadata": {
    "name": "Meeting → Tasks → KB",
    "description": "...",
    "tags": ["meetings"]
  }
}
```

### 4.12 Migration Strategy

- **Schema migrations** managed via Drizzle Kit (migration files in `/migrations`)
- **Migration execution** on application startup (idempotent, version-tracked)
- **SQLite → PostgreSQL** migration tool provided for Core → Scale upgrades
- **Rollback** supported via backup restore (no automatic downgrade)
- **Version tracking** via `schema_migrations` table (version, applied_at, checksum)

---

## 5. API Contracts (Strict Specification)

### 5.1 Authentication

All endpoints (except `/health` and `/api/v1/auth/login`) require authentication via:
- **Bearer token** (JWT) in `Authorization` header
- **API key** in `X-API-Key` header

### 5.2 Standard Response Envelope

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-06-23T10:00:00Z"
  }
}
```

Error response:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": []
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-06-23T10:00:00Z"
  }
}
```

### 5.3 Workflow Endpoints

#### `POST /api/v1/workflows`

Create a new workflow.

- **Auth:** Required (role: write, admin)
- **Request Body:**
```json
{
  "name": "string (required, max 255)",
  "description": "string (optional)",
  "definition": "object (required, valid workflow definition JSON)",
  "tags": ["string"]
}
```
- **Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "string",
    "version": 1,
    "status": "draft",
    "created_at": "timestamp"
  }
}
```
- **Errors:** 400 (validation), 401 (unauthorized), 403 (forbidden), 409 (duplicate name)

#### `GET /api/v1/workflows`

List workflows with pagination and filtering.

- **Auth:** Required (role: read, write, admin)
- **Query Params:**
  - `status` (optional): draft | active | archived
  - `tag` (optional): filter by tag
  - `search` (optional): full-text search on name/description
  - `page` (optional, default 1): page number
  - `per_page` (optional, default 20, max 100): items per page
  - `sort` (optional, default `updated_at:desc`): sort field and direction
- **Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string",
      "status": "active",
      "version": 3,
      "tags": ["meetings"],
      "created_at": "timestamp",
      "updated_at": "timestamp",
      "last_execution": { "status": "succeeded", "started_at": "timestamp" }
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "per_page": 20,
    "total_pages": 3
  }
}
```

#### `GET /api/v1/workflows/:id`

Get workflow by ID.

- **Auth:** Required (role: read, write, admin)
- **Response (200):** Full workflow object including definition

#### `PUT /api/v1/workflows/:id`

Update workflow (creates new version).

- **Auth:** Required (role: write, admin)
- **Request Body:** Partial update (name, description, definition, tags, status)
- **Response (200):** Updated workflow with incremented version
- **Errors:** 400 (validation/topology error), 404 (not found), 409 (version conflict)

#### `DELETE /api/v1/workflows/:id`

Archive (soft-delete) a workflow.

- **Auth:** Required (role: write, admin)
- **Response (200):** `{ "success": true, "data": { "status": "archived" } }`

#### `POST /api/v1/workflows/:id/execute`

Trigger manual execution.

- **Auth:** Required (role: write, admin)
- **Request Body:**
```json
{
  "payload": {}
}
```
- **Response (202):**
```json
{
  "success": true,
  "data": {
    "execution_id": "uuid",
    "status": "pending"
  }
}
```

#### `GET /api/v1/workflows/:id/versions`

Get version history.

- **Auth:** Required (role: read, write, admin)
- **Response (200):** Array of version objects with commit hashes and timestamps

#### `POST /api/v1/workflows/:id/versions/:version/restore`

Restore a previous version.

- **Auth:** Required (role: write, admin)
- **Response (200):** New workflow version reflecting the restored definition

#### `POST /api/v1/workflows/:id/validate`

Validate workflow topology.

- **Auth:** Required (role: write, admin)
- **Response (200):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "errors": [],
    "warnings": ["Node 'node_3' has no outgoing edges"]
  }
}
```

### 5.4 Execution Endpoints

#### `GET /api/v1/executions`

List executions with filtering.

- **Auth:** Required (role: read, write, admin)
- **Query Params:** `workflow_id`, `status`, `trigger_type`, `started_after`, `started_before`, `page`, `per_page`
- **Response (200):** Paginated list of execution summaries

#### `GET /api/v1/executions/:id`

Get execution details.

- **Auth:** Required (role: read, write, admin)
- **Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "workflow_id": "uuid",
    "workflow_version": 3,
    "trigger_type": "event",
    "trigger_payload": {},
    "status": "succeeded",
    "started_at": "timestamp",
    "completed_at": "timestamp",
    "duration_ms": 4523,
    "nodes": [
      {
        "node_id": "node_1",
        "node_type": "recap.extract_action_items",
        "status": "succeeded",
        "input": {},
        "output": {},
        "started_at": "timestamp",
        "completed_at": "timestamp",
        "retry_count": 0
      }
    ]
  }
}
```

#### `POST /api/v1/executions/:id/cancel`

Cancel a running execution.

- **Auth:** Required (role: write, admin)
- **Response (200):** `{ "success": true, "data": { "status": "cancelled" } }`

#### `POST /api/v1/executions/:id/approve`

Approve a paused execution (human-in-the-loop).

- **Auth:** Required (role: write, admin)
- **Response (200):** `{ "success": true, "data": { "status": "running" } }`

#### `POST /api/v1/executions/:id/reject`

Reject a paused execution.

- **Auth:** Required (role: write, admin)
- **Request Body:** `{ "reason": "string" }`
- **Response (200):** `{ "success": true, "data": { "status": "failed" } }`

#### `POST /api/v1/executions/:id/replay`

Re-run a past execution with same inputs.

- **Auth:** Required (role: write, admin)
- **Response (202):** New execution created with same trigger payload

### 5.5 Trigger Endpoints

#### `POST /api/v1/workflows/:id/triggers`

Create a trigger for a workflow.

- **Auth:** Required (role: write, admin)
- **Request Body:**
```json
{
  "trigger_type": "cron",
  "config": { "expression": "0 6 * * *", "timezone": "UTC" }
}
```
- **Response (201):** Created trigger object with ID and webhook URL (if webhook type)

#### `GET /api/v1/workflows/:id/triggers`

List triggers for a workflow.

#### `DELETE /api/v1/triggers/:id`

Delete a trigger.

### 5.6 Connector Endpoints

#### `GET /api/v1/connectors`

List available connector types and configured instances.

#### `POST /api/v1/connectors`

Configure a new connector instance.

#### `POST /api/v1/connectors/:id/test`

Test connector connectivity.

#### `GET /api/v1/connectors/:id/capabilities`

Get connector capabilities (node types it provides).

### 5.7 Webhook Ingress

#### `POST /webhooks/:trigger_id`

External webhook trigger endpoint.

- **Auth:** HMAC-SHA256 signature in `X-Loop-Signature` header
- **Request Body:** Arbitrary JSON (passed as trigger payload)
- **Response (200):** `{ "accepted": true, "execution_id": "uuid" }`
- **Errors:** 401 (invalid signature), 404 (unknown trigger), 429 (rate limited)

### 5.8 WebSocket

#### `WS /ws/executions/:execution_id`

Real-time execution progress stream.

- **Auth:** JWT token in first message or query param
- **Messages (server → client):**
```json
{ "type": "node_started", "node_id": "node_1", "timestamp": "..." }
{ "type": "node_completed", "node_id": "node_1", "output": {}, "timestamp": "..." }
{ "type": "execution_completed", "status": "succeeded", "timestamp": "..." }
```

### 5.9 System Endpoints

#### `GET /health`

Liveness probe (no auth required).

- **Response (200):** `{ "status": "ok" }`

#### `GET /ready`

Readiness probe (no auth required).

- **Response (200):** `{ "status": "ready", "checks": { "database": "ok", "connectors": "ok" } }`
- **Response (503):** `{ "status": "not_ready", "checks": { "database": "error" } }`

#### `GET /metrics`

Prometheus metrics endpoint (no auth required; restrict via network policy).

---

## 6. Business Logic Specification

### 6.1 Workflow Execution Flow

**Trigger:** Event/cron/webhook/manual trigger fires.

**Step-by-step:**

```
1. Trigger Dispatcher receives event
2. Match event against registered triggers (workflow_triggers table)
3. For each matching trigger:
   a. Load workflow definition from State Store (or cache)
   b. Create WorkflowExecution record (status: 'pending')
   c. Emit 'execution.created' event
4. Execution Engine picks up pending execution:
   a. Update status to 'running', set started_at
   b. Parse workflow definition into DAG
   c. Perform topological sort
   d. Initialize execution context (variables, trigger payload)
   e. For each node in topological order:
      i.   Check if all predecessor nodes completed successfully
      ii.  If branch node: evaluate condition, select branch path
      iii. If loop node: evaluate loop condition, iterate
      iv.  If parallel node: fan-out to parallel branches
      v.   Create NodeExecution record (status: 'pending')
      vi.  Resolve input values (variable substitution, type coercion)
      vii. Validate input against node's input_schema
      viii. Dispatch to appropriate handler:
           - Connector node → Connector Registry → Adapter → External API
           - Code node → Sandbox Manager → Isolated execution
           - Control node → Internal logic (branch, loop, parallel)
      ix.  Update NodeExecution (status: 'running', started_at)
      x.   Wait for result (with timeout)
      xi.  On success: store output, update status to 'succeeded'
      xii. On failure: check retry config
           - If retries remaining: wait backoff interval, re-dispatch
           - If retries exhausted: check error-handling path
             - If error path exists: follow it
             - If no error path: mark execution as 'failed'
      xiii. Emit observability events (async, non-blocking)
   f. Mark execution as 'succeeded' (or 'failed')
   g. Set completed_at, calculate duration_ms
   h. Write final state to State Store
   i. Emit 'execution.completed' event
```

**Decision branches:**
- Node has retry config AND fails → retry with backoff
- Node fails all retries AND error path exists → follow error path
- Node fails all retries AND no error path → execution fails
- Branch condition evaluates to true/false → select branch
- Parallel fan-out → execute all branches, fan-in when all complete
- Loop condition true → repeat body; false → exit loop

**Edge cases:**
- Empty workflow (no nodes) → immediately succeeds
- Circular dependency → rejected at validation time (cycle detection)
- Trigger fires while workflow is already running → new execution instance (concurrency limit check)
- Execution timeout (workflow-level) → cancel all in-flight nodes, mark failed
- Code Node throws unhandled exception → captured, node fails, error path or execution fails

### 6.2 Topological Sort Algorithm

```typescript
function topologicalSort(nodes: Node[], edges: Edge[]): Node[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  
  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  
  // Build graph
  for (const edge of edges) {
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }
  
  // Kahn's algorithm
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }
  
  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current)!) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }
  
  if (sorted.length !== nodes.length) {
    throw new WorkflowValidationError("Circular dependency detected");
  }
  
  return sorted.map(id => nodes.find(n => n.id === id)!);
}
```

### 6.3 Retry Logic

```typescript
async function executeWithRetry(
  nodeExecution: () => Promise<NodeResult>,
  config: RetryConfig
): Promise<NodeResult> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.max_attempts; attempt++) {
    try {
      return await nodeExecution();
    } catch (error) {
      lastError = error;
      if (attempt < config.max_attempts) {
        const delay = calculateBackoff(config.backoff, config.initial_delay_ms, attempt);
        await sleep(delay);
      }
    }
  }
  
  throw lastError!;
}

function calculateBackoff(strategy: string, baseDelay: number, attempt: number): number {
  switch (strategy) {
    case 'exponential': return baseDelay * Math.pow(2, attempt);
    case 'linear': return baseDelay * (attempt + 1);
    case 'fixed': return baseDelay;
    default: return baseDelay;
  }
}
```

### 6.4 Egress Policy Evaluation

```typescript
function evaluateEgress(url: string, policies: EgressPolicy[]): EgressDecision {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const ip = resolveIP(hostname);
  const region = lookupRegion(ip);
  
  // Sort by priority (highest first)
  const sorted = [...policies].sort((a, b) => b.priority - a.priority);
  
  for (const policy of sorted) {
    if (!policy.enabled) continue;
    
    let matches = false;
    switch (policy.target_type) {
      case 'domain':
        matches = matchDomain(hostname, policy.target_value);
        break;
      case 'ip_range':
        matches = ipInCIDR(ip, policy.target_value);
        break;
      case 'region':
        matches = region === policy.target_value;
        break;
    }
    
    if (matches) {
      return {
        allowed: policy.rule_type === 'allow',
        matched_policy: policy.id,
        reason: `Matched policy: ${policy.name}`
      };
    }
  }
  
  // Default: deny (secure by default)
  return { allowed: false, matched_policy: null, reason: "No matching allow policy" };
}
```

### 6.5 Circuit Breaker State Machine

```
States: CLOSED → OPEN → HALF_OPEN → CLOSED (or back to OPEN)

CLOSED: Normal operation. Requests pass through.
  → Transition to OPEN when: consecutive_failures >= threshold (default: 5)

OPEN: All requests fail immediately. No external calls made.
  → Transition to HALF_OPEN after: cooldown_period (default: 30s)

HALF_OPEN: Allow one test request through.
  → Transition to CLOSED if: test request succeeds
  → Transition to OPEN if: test request fails
```

### 6.6 Workflow Validation Rules

1. **No orphan nodes:** Every node must be reachable from a trigger/start node
2. **No cycles:** DAG must be acyclic (cycle detection via topological sort)
3. **Port compatibility:** Edge source output type must be compatible with target input type
4. **Required config:** All nodes must have required configuration fields populated
5. **Variable references:** All `{{variable}}` references must resolve to defined variables or node outputs
6. **Trigger exists:** Active workflows must have at least one enabled trigger (or be manually triggerable)

---

## 7. State Management & Data Flow

### 7.1 Stateless vs. Stateful Components

| Component | State Model | Details |
|-----------|-------------|---------|
| `loop-canvas` | Stateless | SPA; all state in API |
| `loop-api` (modules) | Stateless (reads/writes to State Store) | All persistent state in DB |
| Execution Engine (Core) | Stateful (in-memory for active executions) | In-flight execution state in process memory; persisted to SQLite on transitions |
| Execution Engine (Scale) | Stateful (Redis-backed) | Execution state in Redis; can migrate between nodes |
| Trigger Dispatcher | Stateless | Trigger registrations in State Store; matching is stateless |
| Connector Registry | Stateless | Connector configs in State Store |
| Code Node Sandbox | Stateless (per-execution) | Sandboxes created/destroyed per execution |
| Control Plane | Stateful (fleet state in PostgreSQL) | Tracks instance health, deployment state |

### 7.2 Caching Layers

| Cache | Scope | TTL | Invalidation |
|-------|-------|-----|-------------|
| Workflow definition cache | In-memory (per API instance) | Until next save | Invalidate on workflow update |
| Connector capability cache | In-memory | 5 minutes | Time-based + manual refresh |
| Egress policy cache | In-memory | Until policy change | Invalidate on policy update |
| User session/token cache | In-memory | Token lifetime | N/A (JWT self-validating) |
| LLM response cache (optional) | Redis (Scale) / in-memory (Core) | Configurable per workflow | Time-based |

### 7.3 Data Flow: Workflow Execution

```
[Trigger Event]
      │
      ▼
[Trigger Dispatcher] ──match──→ [workflow_triggers table]
      │
      ▼ (create execution)
[Execution Engine] ──read──→ [workflows table / cache]
      │
      ▼ (topological sort)
[Node Dispatch Loop]
      │
      ├─→ [Connector Registry] ──→ [ODW Agent API / External API]
      │         │                         │
      │         ▼                         ▼
      │    [Egress Policy Engine] ──→ [Allow/Deny]
      │         │
      │         ▼
      │    [Node Result] ──→ [node_executions table]
      │
      ├─→ [Code Node Sandbox] ──→ [User Code Execution]
      │         │                         │
      │         ▼                         ▼
      │    [Resource Limiter]       [Typed Output]
      │         │                         │
      │         ▼                         ▼
      │    [Node Result] ──→ [node_executions table]
      │
      └─→ [Control Logic] ──→ [Branch/Loop/Parallel evaluation]
               │
               ▼
         [Next Node(s)]
      │
      ▼ (all nodes complete)
[workflow_executions table] ← update status
      │
      ▼ (async)
[Observability Service] ← metrics, logs, traces
```

### 7.4 Data Flow: Workflow Authoring

```
[User Action: Save Workflow]
      │
      ▼
[API Gateway] ──auth──→ [JWT Validation]
      │
      ▼
[Workflow Authoring Service]
      │
      ├─→ Validate topology (cycle detection, port compatibility)
      ├─→ Increment version
      ├─→ Write to [workflows table]
      ├─→ Write snapshot to [workflow_definitions table]
      └─→ Commit to git repository (via Versioning Service)
              │
              ▼
         [Git bare repo on disk]
```

---

## 8. Background Jobs & Asynchronous Processing

### 8.1 Job: Execution History Pruner

- **Trigger:** Cron schedule (default: daily at 2 AM)
- **Input:** Retention configuration (default: 30 days for full I/O, 365 days for summary)
- **Logic:**
  1. Query executions older than full-I/O retention period
  2. For each: strip `input`/`output` payloads from `node_executions`, retain summary fields
  3. Query executions older than summary retention period
  4. Delete execution and associated node_executions records
- **Idempotency:** Yes (checks timestamps before processing)
- **Retry:** 3 attempts with 1-minute backoff
- **Queue:** Internal scheduler (Core); Redis-backed job queue (Scale)

### 8.2 Job: Connector Health Monitor

- **Trigger:** Every 30 seconds (configurable)
- **Input:** List of configured connectors
- **Logic:**
  1. For each connector: call `healthCheck()` via adapter
  2. Update `connectors.last_health_check` and `connectors.status`
  3. If status changed: emit audit event
  4. If connector transitions to 'error': trigger circuit breaker
- **Idempotency:** Yes
- **Retry:** N/A (fire-and-forget per connector)

### 8.3 Job: Audit Log Writer

- **Trigger:** Event-driven (on every state-changing operation)
- **Input:** Audit event data
- **Logic:** Append to `audit_events` table (synchronous, blocking — must succeed before operation returns)
- **Retry:** 3 immediate retries on write failure (operation fails if audit write fails)
- **Idempotency:** N/A (append-only)

### 8.4 Job: Execution State Recovery (Core Tier)

- **Trigger:** Application startup
- **Input:** In-flight executions in SQLite (status = 'running')
- **Logic:**
  1. Query all executions with status 'running' that were started before last shutdown
  2. For each: check if node_executions indicate partial completion
  3. If recoverable: re-queue execution from last successful node
  4. If not recoverable: mark as 'failed' with error "Interrupted by system restart"
- **Idempotency:** Yes
- **Retry:** N/A (runs once on startup)

### 8.5 Job: Webhook Delivery Retry (Outbound Notifications)

- **Trigger:** Event-driven (on notification delivery failure)
- **Input:** Failed notification payload
- **Logic:** Retry with exponential backoff: 5s, 30s, 5min, 30min
- **Idempotency:** Yes (idempotency key in payload)
- **Queue:** Internal queue (Core); Redis Streams (Scale)
- **Max retries:** 4 (then drop with alert)

### 8.6 Job: Git Repository Maintenance

- **Trigger:** Weekly (Sunday 3 AM)
- **Logic:** Run `git gc` on the workflow versioning repository to optimize storage
- **Idempotency:** Yes

### 8.7 Queue System

- **Core tier:** In-process event queue (Node.js async queue with configurable concurrency)
- **Scale tier:** Redis Streams for execution dispatch; separate streams for notifications, health checks, and maintenance jobs
- **Dead letter queue:** Failed jobs after max retries go to dead letter stream for manual inspection

---

## 9. External Integrations

### 9.1 ODW Vault

- **Purpose:** Knowledge base operations (CRUD documents, search, RAG queries, tag management)
- **Endpoint:** Configurable base URL (e.g., `http://vault:8080`)
- **API:** REST (OpenAPI spec provided by Vault team)
- **Authentication:** API key or mTLS
- **Events:** `document.created`, `document.updated`, `document.deleted`, `search.completed`
- **Rate limits:** Per Vault deployment (typically 100 req/s)
- **Fallback:** Retry with backoff; circuit breaker after 5 failures; graceful degradation (workflow fails at Vault node, other workflows unaffected)

### 9.2 ODW Desk

- **Purpose:** Workspace operations (tasks, projects, calendar, notifications)
- **Endpoint:** Configurable base URL
- **API:** REST (OpenAPI spec provided by Desk team)
- **Authentication:** API key or mTLS
- **Events:** `task.created`, `task.completed`, `calendar.event.created`
- **Rate limits:** Per Desk deployment
- **Fallback:** Same as Vault

### 9.3 ODW Recap

- **Purpose:** Meeting intelligence (ingest transcripts, extract action items, summarize, classify)
- **Endpoint:** Configurable base URL
- **API:** REST (OpenAPI spec provided by Recap team)
- **Authentication:** API key or mTLS
- **Events:** `transcript.completed`, `extraction.completed`
- **Rate limits:** Per Recap deployment
- **Fallback:** Same as Vault

### 9.4 LLM Providers

| Provider | Endpoint | Auth | Rate Limits | Fallback |
|----------|----------|------|-------------|----------|
| Ollama (local) | `http://localhost:11434` | None | Hardware-limited | N/A (local) |
| vLLM (local) | `http://localhost:8000` | None | Hardware-limited | N/A (local) |
| OpenAI | `https://api.openai.com/v1` | Bearer token | Per-tier (TPM/RPM) | Switch provider |
| Anthropic | `https://api.anthropic.com/v1` | x-api-key | Per-tier | Switch provider |
| Azure OpenAI | Configurable deployment URL | API key + deployment | Per-deployment | Switch provider |
| AWS Bedrock | AWS SDK (region-configured) | IAM credentials | Per-account | Switch provider |
| Google Vertex | Google Cloud API | Service account | Per-project | Switch provider |

**Fallback strategy:** Provider abstraction layer. If primary provider fails (circuit breaker open), engine tries next configured provider. If all fail, LLM-dependent nodes fail; non-LLM workflows continue.

### 9.5 HashiCorp Vault (Scale Tier, Optional)

- **Purpose:** Enterprise secrets management
- **Endpoint:** Configurable Vault server URL
- **Authentication:** AppRole or Kubernetes auth method
- **Operations:** Read secrets, dynamic secret generation, automatic rotation
- **Fallback:** Encrypted SQLite/PostgreSQL (Core tier default)

### 9.6 Notification Channels

| Channel | Endpoint | Auth | Rate Limits |
|---------|----------|------|-------------|
| Slack | `https://slack.com/api/chat.postMessage` | Bot token | 1 msg/sec per channel |
| Email (SMTP) | Configurable SMTP server | Username/password or API key | Per-provider |
| Webhook (generic) | Configurable URL | HMAC signature | Per-target |

### 9.7 Premium Connectors (Scale Tier)

| Connector | Endpoint | Auth | Notes |
|-----------|----------|------|-------|
| SAP | SAP OData API | OAuth2 / Basic | Requires SAP connector license |
| Salesforce | Salesforce REST API | OAuth2 | Standard Salesforce integration |
| ServiceNow | ServiceNow REST API | OAuth2 / Basic | ITSM integration |
| Custom ERP | Configurable | Configurable | Built via Connector SDK |

---

## 10. Configuration & Environment Variables

### 10.1 Core Application

| Variable | Purpose | Example (Dev) | Example (Prod) |
|----------|---------|---------------|----------------|
| `LOOP_PORT` | HTTP server port | `3000` | `3000` |
| `LOOP_HOST` | Bind address | `0.0.0.0` | `0.0.0.0` |
| `LOOP_LOG_LEVEL` | Log verbosity | `debug` | `info` |
| `LOOP_ENV` | Environment identifier | `development` | `production` |
| `LOOP_DATA_DIR` | Data directory path | `./data` | `/var/lib/loop` |
| `LOOP_ENCRYPTION_KEY` | Master encryption key (AES-256) | `dev-key-change-me...` | (from secrets manager) |

### 10.2 Database

| Variable | Purpose | Example (Dev) | Example (Prod) |
|----------|---------|---------------|----------------|
| `LOOP_DB_TYPE` | Database backend | `sqlite` | `postgres` |
| `LOOP_DB_PATH` | SQLite file path (Core) | `./data/loop.db` | — |
| `LOOP_DB_HOST` | PostgreSQL host (Scale) | — | `postgres.internal` |
| `LOOP_DB_PORT` | PostgreSQL port | — | `5432` |
| `LOOP_DB_NAME` | Database name | — | `loop` |
| `LOOP_DB_USER` | Database user | — | `loop_app` |
| `LOOP_DB_PASSWORD` | Database password | — | (from secrets) |
| `LOOP_DB_SSL` | Require SSL connection | `false` | `true` |

### 10.3 Redis (Scale Tier)

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_REDIS_URL` | Redis connection URL | `redis://redis.internal:6379` |
| `LOOP_REDIS_PASSWORD` | Redis password | (from secrets) |
| `LOOP_REDIS_TLS` | Enable TLS | `true` |

### 10.4 Execution Engine

| Variable | Purpose | Example (Dev) | Example (Prod) |
|----------|---------|---------------|----------------|
| `LOOP_MAX_CONCURRENT` | Max concurrent executions | `10` | `50` (Core) / `200` (Scale) |
| `LOOP_EXECUTION_TIMEOUT_MS` | Default workflow timeout | `300000` | `600000` |
| `LOOP_NODE_TIMEOUT_MS` | Default node timeout | `30000` | `60000` |
| `LOOP_DEFAULT_RETRY_COUNT` | Default retry attempts | `3` | `3` |
| `LOOP_DEFAULT_BACKOFF` | Default backoff strategy | `exponential` | `exponential` |
| `LOOP_HISTORY_RETENTION_DAYS` | Full I/O retention | `30` | `90` |
| `LOOP_SUMMARY_RETENTION_DAYS` | Summary retention | `365` | `730` |

### 10.5 Sandbox

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_SANDBOX_TYPE` | Sandbox technology | `gvisor` / `firecracker` |
| `LOOP_SANDBOX_URL` | Sandbox service URL | `http://localhost:4000` |
| `LOOP_SANDBOX_MEMORY_MB` | Memory limit per sandbox | `256` |
| `LOOP_SANDBOX_CPU_SECONDS` | CPU time limit | `30` |
| `LOOP_SANDBOX_POOL_SIZE` | Pre-warmed sandbox pool | `3` |

### 10.6 Model Providers

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_LLM_PRIMARY` | Primary LLM provider | `ollama` / `openai` |
| `LOOP_LLM_OLLAMA_URL` | Ollama endpoint | `http://localhost:11434` |
| `LOOP_LLM_VLLM_URL` | vLLM endpoint | `http://localhost:8000` |
| `LOOP_LLM_OPENAI_KEY` | OpenAI API key | `sk-...` |
| `LOOP_LLM_ANTHROPIC_KEY` | Anthropic API key | `sk-ant-...` |
| `LOOP_LLM_AZURE_ENDPOINT` | Azure OpenAI endpoint | `https://my-deploy.openai.azure.com` |
| `LOOP_LLM_AZURE_KEY` | Azure API key | `...` |
| `LOOP_LLM_BEDROCK_REGION` | AWS Bedrock region | `us-east-1` |
| `LOOP_LLM_VERTEX_PROJECT` | GCP Vertex project | `my-project` |
| `LOOP_LLM_FALLBACK_CHAIN` | Fallback provider order | `ollama,openai,anthropic` |

### 10.7 ODW Agent Connections

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_VAULT_URL` | Vault agent base URL | `http://vault:8080` |
| `LOOP_VAULT_API_KEY` | Vault authentication | `vault-api-key-...` |
| `LOOP_DESK_URL` | Desk agent base URL | `http://desk:8080` |
| `LOOP_DESK_API_KEY` | Desk authentication | `desk-api-key-...` |
| `LOOP_RECAP_URL` | Recap agent base URL | `http://recap:8080` |
| `LOOP_RECAP_API_KEY` | Recap authentication | `recap-api-key-...` |

### 10.8 Security & Auth

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_JWT_SECRET` | JWT signing secret | (random 256-bit) |
| `LOOP_JWT_ACCESS_TTL` | Access token lifetime | `15m` |
| `LOOP_JWT_REFRESH_TTL` | Refresh token lifetime | `7d` |
| `LOOP_AUTH_PROVIDER` | Auth method | `local` / `oidc` / `saml` |
| `LOOP_OIDC_ISSUER` | OIDC issuer URL | `https://auth.example.com` |
| `LOOP_OIDC_CLIENT_ID` | OIDC client ID | `loop-app` |
| `LOOP_OIDC_CLIENT_SECRET` | OIDC client secret | (from secrets) |
| `LOOP_API_KEY_SALT` | API key hashing salt | (random) |

### 10.9 Egress & Sovereignty

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_EGRESS_DEFAULT_POLICY` | Default egress behavior | `deny` |
| `LOOP_AIRGAP_MODE` | Disable all outbound | `true` / `false` |
| `LOOP_ALLOWED_REGIONS` | Permitted egress regions | `eu-west,eu-central` |

### 10.10 Observability

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_METRICS_ENABLED` | Enable Prometheus endpoint | `true` |
| `LOOP_OTEL_ENABLED` | Enable OpenTelemetry export | `false` (Core) / `true` (Scale) |
| `LOOP_OTEL_ENDPOINT` | OTLP collector endpoint | `http://otel:4317` |
| `LOOP_ALERT_WEBHOOK_URL` | Alert webhook destination | `https://hooks.slack.com/...` |

### 10.11 Scale Tier / Control Plane

| Variable | Purpose | Example |
|----------|---------|---------|
| `LOOP_INSTANCE_ID` | Unique instance identifier | `loop-frankfurt-1` |
| `LOOP_REGION` | Deployment region | `eu-central-1` |
| `LOOP_CONTROL_PLANE_URL` | Control plane endpoint | `https://control.loop.internal` |
| `LOOP_CLUSTER_TOKEN` | Cluster registration token | (from control plane) |

---

## 11. Security Implementation Details

### 11.1 Authentication Flow

```
1. Client sends POST /api/v1/auth/login { username, password }
2. Server validates credentials (bcrypt compare against users.password_hash)
3. Server generates JWT access token (15 min TTL) + refresh token (7 day TTL)
4. Access token payload:
   {
     "sub": "user-uuid",
     "role": "write",
     "iat": 1719000000,
     "exp": 1719000900,
     "iss": "loop"
   }
5. Client includes access token in Authorization: Bearer <token> header
6. On access token expiry, client sends POST /api/v1/auth/refresh { refresh_token }
7. Server validates refresh token, issues new access token
8. On refresh token expiry, user must re-authenticate
```

### 11.2 Authorization Model (RBAC)

| Permission | Read | Write | Admin |
|-----------|------|-------|-------|
| View workflows | ✅ | ✅ | ✅ |
| Create/edit workflows | ❌ | ✅ | ✅ |
| Execute workflows | ❌ | ✅ | ✅ |
| View executions | ✅ | ✅ | ✅ |
| Cancel executions | ❌ | ✅ | ✅ |
| Manage triggers | ❌ | ✅ | ✅ |
| Manage connectors | ❌ | ❌ | ✅ |
| Manage secrets | ❌ | ❌ | ✅ |
| Manage users/RBAC | ❌ | ❌ | ✅ |
| View audit logs | ✅ | ✅ | ✅ |
| Modify egress policies | ❌ | ❌ | ✅ |
| System configuration | ❌ | ❌ | ✅ |
| Export data | ❌ | ✅ | ✅ |

### 11.3 Token Structure

**Access Token (JWT):**
```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "role": "write",
  "iat": 1719000000,
  "exp": 1719000900,
  "iss": "loop",
  "jti": "unique-token-id"
}
```

**API Key format:** `loop_<scope>_<random-32-chars>` (e.g., `loop_write_a1b2c3d4e5f6...`)
- Stored as SHA-256 hash in database
- Scope determines permissions (read/write/admin)
- Optional expiry timestamp

### 11.4 Data Encryption Strategy

**At Rest:**
- Execution I/O payloads: AES-256-GCM encrypted before writing to database
- Secrets: AES-256-GCM encrypted; separate encryption key from execution data
- Encryption key derived from `LOOP_ENCRYPTION_KEY` env var using HKDF
- Each encrypted field has its own IV (stored alongside ciphertext)

**In Transit:**
- All HTTP/WebSocket: TLS 1.3 (configured at reverse proxy or application level)
- Internal service communication (Scale): mTLS with per-service certificates
- Database connections: TLS enabled (`LOOP_DB_SSL=true`)

**Key Management:**
- Core tier: Single master key from environment variable
- Scale tier: HashiCorp Vault integration (dynamic keys, automatic rotation)
- Key rotation: Manual process (Core); automated via Vault (Scale)

### 11.5 Input Validation & Sanitization

- **All API inputs** validated against Zod schemas before processing
- **SQL queries** use parameterized queries exclusively (Drizzle ORM)
- **JSON inputs** size-limited (max 10MB per request)
- **String inputs** length-limited per field (defined in schema)
- **File uploads** (if any) scanned for type/size; stored outside webroot
- **Webhook payloads** validated against expected schema; malformed payloads rejected
- **Code Node inputs** sanitized before passing to sandbox (no shell injection vectors)
- **Variable interpolation** uses safe template engine (no eval/exec)

### 11.6 Webhook Security

- Inbound webhooks verified via HMAC-SHA256 signature
- Signature computed over raw request body using trigger-specific secret
- Header: `X-Loop-Signature: sha256=<hex-digest>`
- Replay protection: timestamp in signature payload; reject if > 5 minutes old
- Rate limiting: 60 events/minute per webhook trigger

---

## 12. Error Handling & Logging

### 12.1 Standard Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": [
      {
        "field": "name",
        "message": "Name is required",
        "code": "REQUIRED"
      }
    ]
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2026-06-23T10:00:00Z"
  }
}
```

### 12.2 Error Categories

| Category | HTTP Status | Error Code Prefix | Examples |
|----------|-------------|-------------------|---------|
| Validation | 400 | `VALIDATION_*` | `VALIDATION_REQUIRED`, `VALIDATION_TYPE_MISMATCH`, `VALIDATION_RANGE` |
| Authentication | 401 | `AUTH_*` | `AUTH_INVALID_TOKEN`, `AUTH_EXPIRED`, `AUTH_MISSING` |
| Authorization | 403 | `FORBIDDEN_*` | `FORBIDDEN_INSUFFICIENT_ROLE` |
| Not Found | 404 | `NOT_FOUND_*` | `NOT_FOUND_WORKFLOW`, `NOT_FOUND_EXECUTION` |
| Conflict | 409 | `CONFLICT_*` | `CONFLICT_VERSION`, `CONFLICT_DUPLICATE` |
| Rate Limit | 429 | `RATE_LIMIT_*` | `RATE_LIMIT_EXCEEDED` |
| System | 500 | `INTERNAL_*` | `INTERNAL_DB_ERROR`, `INTERNAL_SANDBOX_ERROR` |
| External Dependency | 502/503 | `UPSTREAM_*` | `UPSTREAM_VAULT_UNAVAILABLE`, `UPSTREAM_LLM_TIMEOUT` |
| Workflow Execution | 200 (in execution context) | `NODE_*` | `NODE_TIMEOUT`, `NODE_TYPE_MISMATCH`, `NODE_EGRESS_BLOCKED` |

### 12.3 Logging Format

All logs are structured JSON (Pino format):

```json
{
  "level": 30,
  "time": 1719000000000,
  "pid": 1234,
  "hostname": "loop-app-1",
  "msg": "Workflow execution started",
  "execution_id": "exec-uuid",
  "workflow_id": "wf-uuid",
  "trigger_type": "event",
  "request_id": "req-uuid",
  "component": "engine"
}
```

**Log levels:**
- 10 (trace): Detailed debug information
- 20 (debug): Development diagnostics
- 30 (info): Normal operations (default production level)
- 40 (warn): Recoverable issues, degraded performance
- 50 (error): Failures requiring attention
- 60 (fatal): System-level failures

### 12.4 Correlation IDs

- **`request_id`**: Generated at API Gateway for every HTTP request; propagated to all downstream operations
- **`execution_id`**: Generated when execution starts; attached to all logs within that execution
- **`node_execution_id`**: Generated per node execution; attached to connector call logs
- **`trace_id`**: OpenTelemetry trace ID (Scale tier); propagated across service boundaries

### 12.5 Log Retention

| Log Type | Default Retention | Storage |
|----------|-------------------|---------|
| Application logs | 7 days | Local JSON-line files with rotation |
| Code Node stdout/stderr | 7 days | Local files (sandbox volume) |
| Execution logs (in DB) | Tied to execution history retention | SQLite/PostgreSQL |
| Audit logs | Unlimited | Append-only table |

---

## 13. Performance Considerations

### 13.1 Expected Load

| Metric | Core Tier | Scale Tier (per node) |
|--------|-----------|----------------------|
| Concurrent executions | ≤ 50 | ≤ 200 |
| Executions per day | ≤ 10,000 | ≤ 100,000 |
| API requests/second | ≤ 100 | ≤ 500 |
| Workflows per deployment | ≤ 1,000 | ≤ 10,000 |
| Nodes per workflow | ≤ 200 | ≤ 200 |
| WebSocket connections | ≤ 50 | ≤ 200 |

### 13.2 Bottleneck Analysis

| Bottleneck | Impact | Mitigation |
|------------|--------|------------|
| SQLite write contention (Core) | Limits concurrent writes | WAL mode; hard cap at 50 concurrent; upgrade to PostgreSQL (Scale) |
| LLM inference latency | Dominates workflow duration | Prompt caching; batch inference; model selection guidance; async nodes |
| Code Node cold start | 200ms+ per first execution | Pre-warmed sandbox pool; sandbox reuse |
| Execution history growth | Disk/memory pressure | Configurable retention; automatic pruning; partition-based cleanup |
| Webhook burst | Queue overflow | Async ingestion; per-source rate limiting; backpressure |
| Topological sort on large DAGs | CPU time for 200-node workflows | O(V+E) algorithm; cache sorted order until workflow changes |

### 13.3 Optimization Strategies

**Caching:**
- Workflow definitions cached in-memory (invalidated on save)
- Connector capabilities cached for 5 minutes
- Egress policies cached (invalidated on policy change)
- LLM response cache (optional, configurable TTL)

**Batching:**
- Batch LLM inference calls where multiple nodes in same workflow call same model
- Batch audit log writes (write coalescing within 100ms window)
- Batch execution history pruning (single transaction per run)

**Parallelism:**
- Fan-out/fan-in nodes execute branches in parallel
- Multiple executions run concurrently (up to configured limit)
- Observability writes are async (non-blocking)
- Trigger matching runs in parallel for multiple registered triggers

**Resource Management:**
- Sandbox pool pre-warming (configurable pool size)
- Connection pooling for database (SQLite: single connection with WAL; PostgreSQL: pool of 10-50)
- HTTP connection pooling for connector calls (keep-alive)
- Memory limits enforced per execution (prevent runaway workflows)

### 13.4 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Trigger → first node execution | ≤ 500ms (p95) | Time from trigger event to first node dispatch |
| Engine overhead per node | ≤ 50ms (p95) | Time excluding actual node logic (connector call, code execution) |
| Canvas interaction latency | ≤ 100ms (p95) | Time from user action to UI update |
| Execution history query (1000 rows) | ≤ 2s (p95) | Time to return paginated results |
| API response time (CRUD) | ≤ 200ms (p95) | Excluding execution trigger |
| Cold start (app boot) | ≤ 10s | Time from process start to serving requests |

---

## 14. Testing Strategy

### 14.1 Unit Tests

**Coverage target:** ≥ 80% line coverage for all business logic modules.

| Module | Test Focus |
|--------|-----------|
| `@loop/engine` | Topological sort, state machine transitions, retry logic, branch evaluation |
| `@loop/workflow-authoring` | Validation rules, cycle detection, port compatibility |
| `@loop/triggers` | Cron expression parsing, event matching, webhook signature verification |
| `@loop/connectors` | Adapter interface compliance, request/response transformation |
| `@loop/egress` | Policy evaluation, domain/IP/region matching |
| `@loop/secrets` | Encryption/decryption round-trip, key derivation |
| `@loop/types` | Type validation, coercion, compatibility checking |
| `@loop/versioning` | Git operations, diff generation, restore logic |

**Tools:** Vitest, TypeScript strict mode

### 14.2 Integration Tests

**Scope:** Test interactions between modules and with real databases.

| Test Suite | Description |
|-----------|-------------|
| API integration | Full request/response cycle against test database (SQLite + PostgreSQL) |
| Execution engine | End-to-end workflow execution with mock connectors |
| Trigger → Execution | Event delivery to execution completion |
| Connector → ODW agent | Against mock ODW agent servers (wiremock/nock) |
| Sandbox execution | Code Node execution with resource limits verification |
| Database migrations | Migration apply/rollback on both SQLite and PostgreSQL |

**Tools:** Vitest, testcontainers (for PostgreSQL/Redis), nock (HTTP mocking)

### 14.3 End-to-End Tests

| Scenario | Steps |
|----------|-------|
| Meeting → Tasks → KB | Deploy Loop → configure connectors → create workflow → trigger via Recap event → verify tasks created in Desk → verify summary in Vault |
| Air-gapped deployment | Deploy with `LOOP_AIRGAP_MODE=true` → verify zero outbound connections → execute workflow with local LLM |
| RBAC enforcement | Create users with different roles → verify read-only cannot edit → verify write cannot manage secrets → verify admin can do all |
| Failover (Scale) | Kill one execution node → verify in-flight executions recover on another node |
| Code Node isolation | Execute code that attempts host filesystem access → verify blocked → execute code that attempts unauthorized network → verify blocked |
| Egress policy | Configure deny-all policy → attempt workflow with external API call → verify blocked → add allow rule → verify succeeds |

**Tools:** Playwright (UI), custom harness (API), Docker Compose (environment setup)

### 14.4 Mocking Strategy

| Dependency | Mock Approach |
|-----------|--------------|
| ODW agents (Vault, Desk, Recap) | Mock HTTP servers with predefined responses (nock/wiremock) |
| LLM providers | Mock API responses with canned completions |
| Database | Real SQLite (in-memory) for unit tests; testcontainers for PostgreSQL integration tests |
| Redis | Mock or testcontainers |
| Sandbox | Mock sandbox API for unit tests; real sandbox for integration tests |
| Git | In-memory git repository (isomorphic-git in memory backend) |
| Time | Fake timers (Vitest `vi.useFakeTimers()`) for cron/scheduling tests |

---

## 15. Deployment & Build Instructions

### 15.1 Build Steps

```bash
# Prerequisites: Node.js 20+, Docker, pnpm

# Install dependencies
pnpm install

# Type-check all packages
pnpm typecheck

# Lint
pnpm lint

# Unit tests
pnpm test:unit

# Integration tests (requires Docker)
pnpm test:integration

# Build all packages
pnpm build

# Build container images
docker build -t loop-app:latest -f docker/Dockerfile.app .
docker build -t loop-sandbox:latest -f docker/Dockerfile.sandbox .
docker build -t loop-control-plane:latest -f docker/Dockerfile.controlplane .
```

### 15.2 Dockerfile Requirements

**`docker/Dockerfile.app` (Core tier application):**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
RUN apk add --no-cache git
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1
USER node
CMD ["node", "dist/server.js"]
```

**`docker/Dockerfile.sandbox`:**
```dockerfile
FROM gcr.io/gvisor-images/gvisor:latest AS gvisor
FROM python:3.11-slim
RUN apt-get update && apt-get install -y nodejs npm
COPY sandbox-runner/ /opt/sandbox/
COPY --from=gvisor /runsc /usr/local/bin/
EXPOSE 4000
CMD ["python", "/opt/sandbox/server.py"]
```

### 15.3 Service Startup Sequence

**Core tier (Docker Compose):**
```
1. loop-db (SQLite: volume mount, no startup needed)
2. loop-sandbox (sandbox runtime, must be ready before app)
3. loop-app (main application, connects to DB and sandbox)
4. loop-worker (optional: separate execution worker; can be co-located with app)
```

**Scale tier (Kubernetes):**
```
1. PostgreSQL (StatefulSet or managed)
2. Redis (StatefulSet or managed)
3. loop-sandbox (DaemonSet or pool)
4. loop-api (Deployment + HPA)
5. loop-engine (Deployment + HPA)
6. loop-control-plane (Deployment, Scale tier only)
```

### 15.4 Docker Compose (Core Tier)

```yaml
version: '3.8'
services:
  loop-app:
    image: loop-app:latest
    ports:
      - "3000:3000"
    volumes:
      - loop-data:/var/lib/loop
      - loop-git:/var/lib/loop/git
    environment:
      - LOOP_PORT=3000
      - LOOP_DB_TYPE=sqlite
      - LOOP_DB_PATH=/var/lib/loop/loop.db
      - LOOP_DATA_DIR=/var/lib/loop
      - LOOP_ENCRYPTION_KEY=${LOOP_ENCRYPTION_KEY}
      - LOOP_JWT_SECRET=${LOOP_JWT_SECRET}
    depends_on:
      - loop-sandbox
    restart: unless-stopped

  loop-sandbox:
    image: loop-sandbox:latest
    runtime: runsc  # gVisor
    volumes:
      - sandbox-tmp:/tmp/sandbox
    environment:
      - LOOP_SANDBOX_MEMORY_MB=256
      - LOOP_SANDBOX_CPU_SECONDS=30
    restart: unless-stopped

volumes:
  loop-data:
  loop-git:
  sandbox-tmp:
```

### 15.5 CI/CD Pipeline

```
On every PR:
  1. pnpm install --frozen-lockfile
  2. pnpm typecheck
  3. pnpm lint
  4. pnpm test:unit
  5. pnpm test:integration (with testcontainers)
  6. Dependency vulnerability scan (pnpm audit)
  7. Docker image build (verify build succeeds)

On merge to main:
  1. All PR checks
  2. pnpm build
  3. Docker image build + tag with semver
  4. Push to container registry
  5. Generate Helm chart update (Scale tier)
  6. Create GitHub release with changelog
  7. Build air-gapped update package (signed tarball)
```

### 15.6 Air-Gapped Update Procedure

```bash
# On internet-connected machine:
loop-cli release bundle --version 1.2.0 --output loop-bundle-1.2.0.tar.gz
gpg --sign loop-bundle-1.2.0.tar.gz

# Transfer to air-gapped environment (USB/internal registry)

# On air-gapped machine:
gpg --verify loop-bundle-1.2.0.tar.gz.sig
docker load < loop-bundle-1.2.0.tar.gz
docker compose pull  # uses locally loaded images
docker compose up -d
```

---

## 16. Observability Hooks

### 16.1 Metrics (Prometheus)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `loop_executions_total` | Counter | `workflow_id`, `status` | Total workflow executions |
| `loop_execution_duration_seconds` | Histogram | `workflow_id` | Execution duration |
| `loop_node_duration_seconds` | Histogram | `node_type`, `workflow_id` | Per-node execution duration |
| `loop_node_errors_total` | Counter | `node_type`, `error_type` | Node execution errors |
| `loop_connector_calls_total` | Counter | `connector_type`, `status` | Connector API calls |
| `loop_connector_latency_seconds` | Histogram | `connector_type` | Connector call latency |
| `loop_trigger_fires_total` | Counter | `trigger_type`, `workflow_id` | Trigger activations |
| `loop_active_executions` | Gauge | — | Currently running executions |
| `loop_queue_depth` | Gauge | — | Pending executions in queue |
| `loop_circuit_breaker_state` | Gauge | `connector_type` | Circuit breaker state (0=closed, 1=open, 2=half-open) |
| `loop_sandbox_active` | Gauge | — | Active sandbox instances |
| `loop_sandbox_cold_start_seconds` | Histogram | — | Sandbox creation latency |
| `loop_egress_blocked_total` | Counter | `destination` | Blocked egress attempts |
| `loop_api_requests_total` | Counter | `method`, `path`, `status` | API request counts |
| `loop_api_latency_seconds` | Histogram | `method`, `path` | API response latency |
| `loop_db_query_duration_seconds` | Histogram | `operation` | Database query latency |

### 16.2 Logs to Emit

| Event | Level | Fields |
|-------|-------|--------|
| Execution started | INFO | execution_id, workflow_id, trigger_type |
| Execution completed | INFO | execution_id, status, duration_ms |
| Execution failed | ERROR | execution_id, error, failed_node_id |
| Node started | DEBUG | execution_id, node_id, node_type |
| Node completed | DEBUG | execution_id, node_id, duration_ms |
| Node failed | WARN | execution_id, node_id, error, retry_count |
| Connector call | DEBUG | connector_type, endpoint, duration_ms, status |
| Egress blocked | WARN | destination, policy_id, execution_id |
| Circuit breaker opened | WARN | connector_type, failure_count |
| Authentication failure | WARN | username, ip_address, reason |
| Rate limit hit | WARN | user_id, endpoint |
| Sandbox created/destroyed | DEBUG | sandbox_id, workflow_id |

### 16.3 Traces (OpenTelemetry — Scale Tier)

**Trace structure per execution:**
```
[Trigger Reception]
  └─ [Execution: workflow_name]
       ├─ [Node: node_type_1]
       │    └─ [Connector Call: vault.upsert_document]
       ├─ [Node: node_type_2]
       │    └─ [Sandbox: code_execution]
       └─ [Node: node_type_3]
            └─ [Connector Call: desk.create_task]
```

**Span attributes:**
- `loop.execution_id`, `loop.workflow_id`, `loop.node_id`
- `loop.node_type`, `loop.trigger_type`
- `loop.retry_count`, `loop.status`
- Standard OpenTelemetry semantic conventions for HTTP, DB, RPC

### 16.4 Health Check Endpoints

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /health` | Liveness | `{ "status": "ok" }` (200) or 503 |
| `GET /ready` | Readiness | Checks DB connectivity, sandbox availability |
| `GET /ready/db` | DB check | `{ "status": "ok" }` or `{ "status": "error", "detail": "..." }` |
| `GET /ready/sandbox` | Sandbox check | Verifies sandbox service responds |
| `GET /ready/connectors` | Connector health | Aggregated connector status |

**Kubernetes probes:**
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## 17. File & Folder Structure

```
loop/
├── package.json                    # Root workspace config (pnpm)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json              # Shared TypeScript config
├── vitest.config.ts                # Root test config
├── .eslintrc.js
├── .prettierrc
├── Dockerfile.app
├── Dockerfile.sandbox
├── Dockerfile.controlplane
├── docker-compose.yml              # Core tier deployment
├── docker-compose.dev.yml          # Development environment
│
├── apps/
│   ├── api/                        # Main application (loop-api)
│   │   ├── src/
│   │   │   ├── server.ts           # Fastify server entry point
│   │   │   ├── config.ts           # Environment variable loading
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts         # Authentication endpoints
│   │   │   │   ├── workflows.ts    # Workflow CRUD
│   │   │   │   ├── executions.ts   # Execution management
│   │   │   │   ├── triggers.ts     # Trigger management
│   │   │   │   ├── connectors.ts   # Connector management
│   │   │   │   ├── secrets.ts      # Secrets management
│   │   │   │   ├── audit.ts        # Audit log queries
│   │   │   │   ├── system.ts       # Health, ready, metrics
│   │   │   │   └── webhooks.ts     # Webhook ingress
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts         # JWT/API key validation
│   │   │   │   ├── rateLimit.ts    # Rate limiting
│   │   │   │   ├── rbac.ts         # Role-based access control
│   │   │   │   ├── cors.ts         # CORS configuration
│   │   │   │   └── errorHandler.ts # Global error handler
│   │   │   └── websocket/
│   │   │       └── executionStream.ts  # Real-time execution updates
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── canvas/                     # Frontend (loop-canvas)
│   │   ├── src/
│   │   │   ├── main.tsx            # React entry point
│   │   │   ├── App.tsx
│   │   │   ├── routes/             # React Router routes
│   │   │   ├── components/
│   │   │   │   ├── canvas/         # Workflow canvas editor
│   │   │   │   │   ├── CanvasEditor.tsx
│   │   │   │   │   ├── NodeLibrary.tsx
│   │   │   │   │   ├── NodeConfigPanel.tsx
│   │   │   │   │   ├── nodes/      # Custom React Flow node types
│   │   │   │   │   └── edges/      # Custom edge types
│   │   │   │   ├── executions/     # Execution monitoring
│   │   │   │   ├── dashboard/      # Metrics dashboard
│   │   │   │   ├── admin/          # Admin panel
│   │   │   │   └── common/         # Shared UI components
│   │   │   ├── stores/             # Zustand stores
│   │   │   │   ├── workflowStore.ts
│   │   │   │   ├── executionStore.ts
│   │   │   │   └── authStore.ts
│   │   │   ├── api/                # API client
│   │   │   ├── hooks/              # Custom React hooks
│   │   │   ├── i18n/               # Internationalization
│   │   │   └── styles/             # Tailwind config
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── sandbox/                    # Code Node sandbox runtime
│   │   ├── src/
│   │   │   ├── server.ts           # Sandbox API server
│   │   │   ├── executor.ts         # Code execution logic
│   │   │   ├── python/             # Python runtime wrapper
│   │   │   ├── nodejs/             # Node.js runtime wrapper
│   │   │   ├── network.ts          # Network policy enforcement
│   │   │   └── resources.ts        # Resource limit enforcement
│   │   ├── requirements.txt        # Python dependencies for sandbox
│   │   └── package.json
│   │
│   └── control-plane/              # Scale tier control plane
│       ├── src/
│       │   ├── server.ts
│       │   ├── fleet/              # Fleet management
│       │   ├── deployment/         # Workflow distribution
│       │   ├── residency/          # Cross-region enforcement
│       │   └── failover/           # HA coordination
│       └── package.json
│
├── packages/                       # Shared libraries (internal modules)
│   ├── engine/                     # @loop/engine
│   │   ├── src/
│   │   │   ├── executor.ts         # Main execution loop
│   │   │   ├── scheduler.ts        # Topological sort + dispatch
│   │   │   ├── stateMachine.ts     # Execution state transitions
│   │   │   ├── retry.ts            # Retry logic
│   │   │   ├── circuitBreaker.ts   # Circuit breaker implementation
│   │   │   └── nodes/              # Built-in node type handlers
│   │   │       ├── branch.ts
│   │   │       ├── loop.ts
│   │   │       ├── parallel.ts
│   │   │       ├── approval.ts
│   │   │       └── delay.ts
│   │   └── package.json
│   │
│   ├── workflow-authoring/         # @loop/workflow-authoring
│   │   ├── src/
│   │   │   ├── service.ts          # Workflow CRUD operations
│   │   │   ├── validator.ts        # Topology validation
│   │   │   └── topology.ts         # Graph operations (cycle detection)
│   │   └── package.json
│   │
│   ├── versioning/                 # @loop/versioning
│   │   ├── src/
│   │   │   ├── service.ts          # Version management
│   │   │   ├── git.ts              # Git operations (isomorphic-git)
│   │   │   └── diff.ts             # Version diff generation
│   │   └── package.json
│   │
│   ├── triggers/                   # @loop/triggers
│   │   ├── src/
│   │   │   ├── dispatcher.ts       # Trigger matching and dispatch
│   │   │   ├── cron.ts             # Cron trigger handler
│   │   │   ├── webhook.ts          # Webhook trigger handler
│   │   │   ├── event.ts            # ODW agent event trigger handler
│   │   │   └── manual.ts           # Manual trigger handler
│   │   └── package.json
│   │
│   ├── connectors/                 # @loop/connectors
│   │   ├── src/
│   │   │   ├── registry.ts         # Connector registry
│   │   │   ├── interface.ts        # Connector interface definition
│   │   │   ├── vault/              # Vault adapter
│   │   │   ├── desk/               # Desk adapter
│   │   │   ├── recap/              # Recap adapter
│   │   │   ├── generic/            # Generic ODW agent adapter
│   │   │   ├── notification/       # Slack, email, webhook notifications
│   │   │   └── premium/            # Scale tier premium connectors
│   │   └── package.json
│   │
│   ├── types/                      # @loop/types (Semantic Type System)
│   │   ├── src/
│   │   │   ├── registry.ts         # Type registry
│   │   │   ├── schemas/            # Zod schemas for each type
│   │   │   │   ├── document.ts
│   │   │   │   ├── transcript.ts
│   │   │   │   ├── actionItem.ts
│   │   │   │   ├── task.ts
│   │   │   │   └── calendarEvent.ts
│   │   │   ├── validator.ts        # Runtime type validation
│   │   │   └── coercion.ts         # Type coercion/transformation
│   │   └── package.json
│   │
│   ├── state/                      # @loop/state (State Store)
│   │   ├── src/
│   │   │   ├── interface.ts        # State store interface
│   │   │   ├── sqlite/             # SQLite implementation
│   │   │   ├── postgres/           # PostgreSQL implementation
│   │   │   └── migrations/         # Schema migration files
│   │   └── package.json
│   │
│   ├── secrets/                    # @loop/secrets
│   │   ├── src/
│   │   │   ├── manager.ts          # Secret CRUD with encryption
│   │   │   ├── encryption.ts       # AES-256-GCM implementation
│   │   │   └── vault.ts            # HashiCorp Vault integration
│   │   └── package.json
│   │
│   ├── egress/                     # @loop/egress
│   │   ├── src/
│   │   │   ├── engine.ts           # Policy evaluation engine
│   │   │   ├── resolver.ts         # DNS + IP geolocation
│   │   │   └── interceptor.ts      # Network call interceptor
│   │   └── package.json
│   │
│   ├── observability/              # @loop/observability
│   │   ├── src/
│   │   │   ├── logger.ts           # Pino logger setup
│   │   │   ├── metrics.ts          # Prometheus metrics definitions
│   │   │   ├── tracing.ts          # OpenTelemetry setup
│   │   │   └── alerting.ts         # Alert rule evaluation
│   │   └── package.json
│   │
│   └── llm/                        # @loop/llm (Model Provider Abstraction)
│       ├── src/
│       │   ├── interface.ts        # Provider interface
│       │   ├── ollama.ts           # Ollama provider
│       │   ├── vllm.ts             # vLLM provider
│       │   ├── openai.ts           # OpenAI provider
│       │   ├── anthropic.ts        # Anthropic provider
│       │   ├── azure.ts            # Azure OpenAI provider
│       │   ├── bedrock.ts          # AWS Bedrock provider
│       │   ├── vertex.ts           # Google Vertex provider
│       │   └── router.ts           # Provider routing + fallback
│       └── package.json
│
├── migrations/                     # Database migration files
│   ├── 001_initial_schema.ts
│   ├── 002_add_egress_policies.ts
│   └── ...
│
├── helm/                           # Kubernetes Helm chart (Scale tier)
│   ├── Chart.yaml
│   ├── values.yaml
│   ├── values.scale.yaml
│   └── templates/
│       ├── api-deployment.yaml
│       ├── engine-deployment.yaml
│       ├── sandbox-daemonset.yaml
│       ├── control-plane-deployment.yaml
│       ├── postgres-statefulset.yaml
│       ├── redis-statefulset.yaml
│       ├── ingress.yaml
│       ├── hpa.yaml
│       └── ...
│
├── templates/                      # Bundled workflow templates
│   ├── meeting-to-tasks.json
│   ├── research-summarize-store.json
│   ├── document-ingestion.json
│   └── ...
│
├── docs/                           # Documentation
│   ├── api-reference.md
│   ├── node-reference.md
│   ├── deployment-guide.md
│   └── ...
│
└── tests/
    ├── unit/                       # Unit tests (mirror source structure)
    ├── integration/                # Integration tests
    ├── e2e/                        # End-to-end tests
    └── fixtures/                   # Test data and mocks
```

---

## 18. Coding Standards & Conventions

### 18.1 Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (TypeScript) | camelCase | `workflowService.ts` |
| Files (React components) | PascalCase | `CanvasEditor.tsx` |
| Directories | kebab-case | `workflow-authoring/` |
| Variables/functions | camelCase | `getWorkflowById` |
| Classes | PascalCase | `ExecutionEngine` |
| Interfaces | PascalCase, prefixed with `I` only if ambiguous | `ConnectorAdapter`, `WorkflowDefinition` |
| Types | PascalCase | `NodeExecution`, `SemanticType` |
| Enums | PascalCase (name), UPPER_SNAKE (values) | `ExecutionStatus.SUCCEEDED` |
| Constants | UPPER_SNAKE_CASE | `MAX_CONCURRENT_EXECUTIONS` |
| Environment variables | UPPER_SNAKE_CASE with `LOOP_` prefix | `LOOP_DB_TYPE` |
| Database tables | snake_case, plural | `workflow_executions` |
| Database columns | snake_case | `created_at` |
| API paths | kebab-case, plural nouns | `/api/v1/workflows` |
| API query params | snake_case | `workflow_id` |
| JSON keys (API responses) | snake_case | `execution_id` |
| Git branches | kebab-case with type prefix | `feat/visual-builder`, `fix/retry-logic` |

### 18.2 API Naming Rules

- RESTful resource naming: plural nouns (`/workflows`, `/executions`)
- Nested resources max 2 levels: `/workflows/:id/triggers` (not deeper)
- Actions that aren't CRUD use POST with verb: `POST /executions/:id/cancel`
- Consistent pagination: `page`, `per_page`, `total`, `total_pages` in meta
- Consistent filtering: query params for filters, not path segments
- Versioning: URL path (`/api/v1/...`)

### 18.3 Error Format Standards

All errors follow the standard envelope (Section 12.1). Specific rules:
- Error codes are UPPER_SNAKE_CASE with category prefix
- Messages are human-readable, lowercase start, no period at end
- Details array provides field-level validation errors
- Never expose stack traces in API responses (log server-side only)
- Include `request_id` in every error for support debugging

### 18.4 Code Organization Principles

1. **Single responsibility:** Each module/file has one clear purpose
2. **Dependency injection:** Services receive dependencies via constructor/factory, not global imports
3. **Interface-first:** Define interfaces before implementations; depend on abstractions
4. **Explicit over implicit:** No magic; all behavior is traceable
5. **Fail fast:** Validate inputs at boundaries; throw early on invalid state
6. **Immutable data:** Prefer readonly types; never mutate shared state
7. **Async/await:** No raw callbacks; use async/await for all asynchronous operations
8. **Error boundaries:** Each service handles its own errors; propagate typed errors upward
9. **No side effects in getters:** Functions named `get*` must not modify state
10. **Test proximity:** Unit tests mirror source structure (`src/engine/executor.ts` → `tests/unit/engine/executor.test.ts`)

### 18.5 TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### 18.6 Git Conventions

- **Commit messages:** Conventional Commits format (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **PR titles:** Same conventional format
- **Branch protection:** Require passing CI, require review, no force push to main
- **Release tags:** Semantic versioning (`v1.0.0`, `v1.1.0-rc.1`)

---

## 19. Assumptions & Constraints

### 19.1 Assumptions (Inherited from PRD/SAD)

| # | Assumption | Risk if Wrong |
|---|-----------|---------------|
| A1 | ODW agent modules (Vault, Desk, Recap) expose stable APIs with published OpenAPI specs and event schemas | High — connector development blocked; launch delayed |
| A2 | Target customers have Docker/Kubernetes expertise or access to someone who does | Medium — reduces addressable market |
| A3 | Local LLMs (Ollama, vLLM) deliver acceptable latency (≤ 5s for typical workflow inference) on commodity hardware | Medium — users forced to remote APIs; sovereignty weakened |
| A4 | SMBs in regulated industries prioritize sovereignty enough to accept self-hosting complexity | Medium — market smaller than projected |
| A5 | SQLite handles Core-tier concurrency (≤ 50 concurrent executions) without unacceptable contention in WAL mode | Low — can reduce cap if needed |
| A6 | gVisor provides adequate sandboxing with < 200ms cold start on target hardware | Low — Firecracker as fallback |
| A7 | Git (isomorphic-git) can be bundled without significant binary size increase or platform compatibility issues | Low — alternative VFS if needed |
| A8 | Premium connectors (SAP, Salesforce, ServiceNow) can be built within 6 months by a small team | Medium — Scale tier GA delayed |
| A9 | ODW agents will maintain backward-compatible API evolution (no breaking changes within v1.x) | High — connector breakage; version pinning mitigates |
| A10 | Customers' network infrastructure allows Docker container communication on configured ports | Low — deployment guide covers common setups |

### 19.2 Technical Constraints

| # | Constraint | Impact |
|---|-----------|--------|
| C1 | Must run fully air-gapped (zero outbound network) | Cannot depend on cloud services at runtime; all dependencies bundled in container images |
| C2 | No telemetry without explicit opt-in | Reduced product analytics; must rely on self-reported feedback |
| C3 | Open-core model (Apache 2.0 core) | Proprietary differentiation limited to Scale-tier features |
| C4 | Must integrate with ODW agents as they exist today | Adapter layer required; tight coupling mitigated by interface abstraction |
| C5 | Target market is SMB (price-sensitive, small IT teams) | UX must be simple; one-command install required; docs must be excellent |
| C6 | v1.0 must ship within 9 months | P0 features only; P2 deferred; scope discipline required |
| C7 | Code Node must be sandboxed (no host access) | Limits custom code capabilities; must provide rich built-in primitives |
| C8 | Must support ≥ 5 LLM providers at launch | Engineering effort for provider abstraction layer |
| C9 | Single-tenant by design | Each deployment serves one organization; simplifies data model |
| C10 | Core tier resource budget: ≤ 2GB RAM, ≤ 2 CPU cores at idle | Limits in-process concurrency; drives architectural choices |
| C11 | Workflow definitions must be portable (JSON/YAML export/import) | Cannot use database-specific features in workflow storage |
| C12 | Backward compatibility: v1.0 workflows must run on any v1.x release | Schema evolution must be additive-only within major version |

### 19.3 Known Unknowns (Requiring Validation)

| # | Unknown | Validation Plan | Decision Deadline |
|---|---------|----------------|-------------------|
| U1 | gVisor vs. Firecracker cold start performance on target hardware | PoC benchmark in month 1 | Month 2 |
| U2 | SQLite write throughput under 50 concurrent executions | Load testing in month 2 | Month 3 |
| U3 | ODW agent API stability timeline | Joint planning with ODW teams | Month 1 |
| U4 | Premium connector development velocity | Spike on Salesforce connector | Month 4 |
| U5 | Core-to-Scale conversion rate | Beta user surveys + pricing validation | Month 6 |

---

## 20. Reference Implementations & Code Patterns (Added 2026-06-24)

Based on analysis of 6 cloned reference repositories in `reference/` directory. Each subsection maps TSD tasks to specific reference code that should be consulted during implementation.

### 20.1 Reference Repository Index

| Repository | Path | License | Stars | Primary Use |
|-----------|------|---------|-------|-------------|
| Activepieces | `reference/activepieces/` | MIT | 25K+ | Piece SDK, trigger system, monorepo, canvas |
| n8n | `reference/n8n/` | Fair-code (SUL) | 180K+ | Execution engine, credentials, webhooks, errors |
| Flowise | `reference/Flowise/` | Apache 2.0 | 31K+ | React Flow canvas, LLM integration |
| Trigger.dev | `reference/trigger.dev/` | Apache 2.0 | 10K+ | Durable execution, retry, TypeScript API |
| Inngest | `reference/inngest/` | Apache 2.0 | 5K+ | Event-driven workflows, step functions |
| Windmill | `reference/windmill/` | AGPLv3 | 16K+ | Multi-language execution, RBAC |

### 20.2 Task-to-Reference Mapping

#### INFRA-001: Monorepo Scaffolding
- **Consult:** `reference/activepieces/pnpm-workspace.yaml` — Activepieces monorepo structure (packages/core/*, packages/server/*, packages/web)
- **Consult:** `reference/trigger.dev/package.json` — Trigger.dev's Turborepo + pnpm workspace config
- **Consult:** `reference/n8n/package.json` — n8n's pnpm workspace with Turbo build orchestration

#### INFRA-005: Database Migration Framework
- **Consult:** `reference/activepieces/packages/core/shared/src/` — Activepieces' TypeORM migration patterns
- **Adapt:** Our Drizzle ORM approach is lighter and more TypeScript-native than TypeORM

#### CORE-001: State Store Interface & SQLite
- **Consult:** `reference/activepieces/packages/server/api/src/app/database/` — Activepieces' database abstraction layer
- **Pattern:** Activepieces uses repository pattern with clean interface boundaries — mirror this for our StateStore interface

#### CORE-003: Authentication Service
- **Consult:** `reference/n8n/packages/cli/src/controllers/auth.controller.ts` — n8n's JWT auth flow
- **Consult:** `reference/activepieces/packages/server/api/src/app/authentication/` — Activepieces' auth module
- **Adapt:** Our `jose` library choice is modern and well-maintained

#### CORE-006: Workflow Authoring Service
- **Consult:** `reference/n8n/packages/workflow/src/workflow.ts` — n8n's pure Workflow graph model (nodes map, dual adjacency maps, graph query methods)
- **Consult:** `reference/n8n/packages/workflow/src/workflow-validation.ts` — n8n's topology validation
- **Pattern:** n8n's `Workflow` class is pure (no execution state) — excellent separation

#### ENGINE-001: Topological Sort & DAG Scheduler
- **Consult:** `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` (~2900 lines) — n8n's worklist/stack-driven interpreter
- **Key Pattern:** `nodeExecutionStack` + `waitingExecution` join map for multi-input nodes
- **Consult:** `reference/trigger.dev/internal-packages/run-engine/src/engine/` — Trigger.dev's modular subsystem approach
- **Adaptation:** Use Kahn's algorithm (TSD §6.2) for initial ordering, then worklist stack for execution with join map for fan-in

#### ENGINE-002: Execution State Machine
- **Consult:** `reference/trigger.dev/internal-packages/run-engine/src/engine/` — Trigger.dev's execution snapshot chain
- **Pattern:** Every state transition creates an immutable snapshot chained via `previousSnapshotId`
- **Extension:** Add WAITPOINTS and SUSPENDED states to our state machine for human-in-the-loop approval nodes

#### ENGINE-003: Main Execution Executor
- **Consult:** `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` — n8n's main execution loop
- **Consult:** `reference/activepieces/packages/core/execution/src/lib/flow-run/execution/` — Activepieces' flow execution
- **Pattern:** n8n's `WorkflowDataProxy` for expression evaluation (`$json`, `$input`, `$('NodeName')`) — adapt for our `{{variable}}` interpolation

#### ENGINE-004: Retry Logic
- **Consult:** `reference/trigger.dev/packages/core/src/retry.ts` — Trigger.dev's retry with error classification
- **Consult:** `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` — n8n's retry loop (count + fixed delay)
- **Pattern:** Trigger.dev's error classification (always-retry vs never-retry categories) is more sophisticated than blind retry counts
- **Adaptation:** Combine n8n's simple retry loop with Trigger.dev's error classification

#### ENGINE-005: Circuit Breaker
- **Consult:** `reference/n8n/packages/core/src/` — n8n implements circuit breaker patterns for external service calls
- **Pattern:** Per-connector isolation (one connector's failures don't affect others)

#### ENGINE-006: Control Flow Node Handlers
- **Consult:** `reference/n8n/packages/nodes-base/nodes/` — n8n's If/Switch/Merge/Loop node implementations
- **Consult:** `reference/activepieces/packages/core/execution/src/lib/flows/` — Activepieces' branch and loop handling
- **Pattern:** n8n's `continueErrorOutput` with paired-item tracing for visual error branches

#### CONN-001: Connector Interface & Registry
- **Consult:** `reference/n8n/packages/workflow/src/` — n8n's `INodeType`, `INodeTypeDescription`, `INodeExecutionData` interfaces
- **Consult:** `reference/activepieces/packages/pieces/framework/` — Activepieces' piece SDK framework
- **Pattern:** n8n's `NodeConnectionType` for typed connections (main, ai_tool, ai_memory) — map to our semantic types
- **Pattern:** Activepieces' self-contained piece pattern (actions + triggers + auth per connector)

#### CONN-006: LLM Provider Abstraction Layer
- **Consult:** `reference/Flowise/packages/components/nodes/` — Flowise's LLM node implementations for various providers
- **Consult:** `reference/activepieces/packages/pieces/community/` — Activepieces' AI/LLM pieces
- **Pattern:** Provider interface with `complete()`, `embed()`, `stream()` methods

#### TRIG-003: Webhook Trigger Handler
- **Consult:** `reference/n8n/packages/cli/src/` — n8n's webhook registration, lookup caching, dynamic paths
- **Pattern:** DB persistence + in-memory cache + atomic registration prevents path conflicts
- **Pattern:** Multiple response modes (immediate, wait-for-completion, streaming)

#### SEC-001: Encryption Module
- **Consult:** `reference/n8n/packages/core/src/encryption/aes-256-gcm.ts` — n8n's AES-256-GCM with HKDF key derivation
- **Pattern:** Envelope encryption with two-tier hierarchy (instance key → DEK → data)
- **Pattern:** Format versioning (byte prefix) for forward-compatible encryption changes
- **Adaptation:** Our TSD §11.4 single-key approach is simpler; consider envelope encryption for Scale tier

#### SEC-002: Secrets Manager
- **Consult:** `reference/n8n/packages/cli/src/credentials-helper.ts` — n8n's full credential lifecycle
- **Pattern:** `getDecrypted()` → load entity → decrypt blob → apply defaults/overwrites → return
- **Pattern:** OAuth2 auto-refresh on 401 with token persistence
- **Pattern:** Expression-based credential injection (`{{$credentials.accessToken}}`)

#### SEC-003: Egress Policy Engine
- **Consult:** `reference/n8n/packages/core/src/credential-domain-restrictions.ts` — n8n's domain restriction approach
- **No direct reference for full egress policy engine** — Loop's implementation will be novel

#### SEC-004: Code Node Sandbox
- **⚠️ CRITICAL:** n8n's VM/WASM sandboxing had two critical CVEs in 2025 (severity 9.9). DO NOT use VM/WASM as sole isolation.
- **Consult:** E2B (not cloned) — Firecracker-based sandbox lifecycle with pool management
- **Consult:** `reference/trigger.dev/internal-packages/compute/` — Trigger.dev's Firecracker VM gateway
- **Pattern:** gVisor as primary (faster cold start), Firecracker as fallback (stronger isolation)

#### FE-002: Canvas Editor (React Flow)
- **Consult:** `reference/Flowise/packages/ui/src/` — Flowise's React Flow implementation
- **Consult:** `reference/activepieces/packages/web/src/` — Activepieces' React Flow canvas with custom nodes
- **Pattern:** Reactive `useCanvasMapping()` composable transforms workflow document → React Flow nodes/edges
- **Pattern:** Custom node types with typed input/output handles and port compatibility visual feedback
- **Pattern:** Dagre library for automatic graph layout

#### FE-004: Execution Monitor
- **Consult:** `reference/n8n/packages/frontend/editor-ui/src/` — n8n's execution visualization
- **Pattern:** WebSocket (preferred) or SSE fallback for real-time updates
- **Pattern:** Per-node status colors: running (animated), waiting (amber), success (green), error (red)

### 20.3 Security Advisories

| Advisory | Source | Impact on Loop |
|----------|--------|---------------|
| n8n CVE-2025-68668 (severity 9.9) | Pyodide WASM sandbox escape | Validates gVisor/Firecracker requirement (SEC-004) |
| n8n CVE-2025-68613 | Node.js VM sandbox escape | VM-based sandboxing is insufficient |
| vm2 CVE-2026-22709 | Critical sandbox escape | Do NOT use vm2 as sole isolation layer |

### 20.4 Architecture Decisions Informed by Research

| Decision | TSD Section | Research Finding | Resolution |
|----------|------------|-----------------|------------|
| Execution model | §6.1-6.2 | Worklist interpreter (n8n) vs modular subsystems (Trigger.dev) | Hybrid: Kahn's sort + worklist stack + join map + modular code organization |
| State machine | §4.3 | Trigger.dev adds WAITPOINTS and SUSPENDED states | Extend state machine with approval/pause states |
| Error handling | §6.1 | n8n's 3-tier routing + Trigger.dev's error classification | Combine: retry with error classification + error output channels + error workflows |
| Encryption | §11.4 | n8n's envelope encryption with key rotation | Single-key for Core; envelope encryption for Scale |
| Credential flow | §11.1 | n8n's expression-based injection + OAuth2 auto-refresh | Adapt n8n's pattern for connector credential management |
| Webhook architecture | §5.7 | n8n's DB+cache+atomic registration | Adopt n8n's caching and response mode patterns |
| Canvas | §3.2 | React Flow validated across 4 major platforms | Confirmed — React Flow is correct choice |
| Sandboxing | §2.3 | n8n CVEs prove VM/WASM insufficient | gVisor primary, Firecracker fallback — validated |

---

**End of Technical Specification Document**

*This document is implementation-ready. An AI coding agent should be able to build the complete Loop system by following this specification with minimal interpretation. All sections align with the PRD and SAD. Where ambiguity exists, the more restrictive interpretation should be chosen (security-first, sovereignty-first). Reference implementations in `reference/` provide concrete code patterns for each task.*
