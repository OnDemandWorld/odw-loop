# Loop — Task Breakdown Document (TBK)

**Product:** Loop (ODW.ai Suite)
**Version:** 1.0
**Generated:** 2026-06-23
**Source:** TSD v1.0 (Final Draft)
**Classification:** Internal — Execution-Ready

---

## 1. Execution Overview

### 1.1 Implementation Strategy

Loop is a modular monolith (Core tier) with a clear separation into shared packages (`@loop/*`) and application entry points (`apps/*`). The implementation proceeds in 7 phases, each independently verifiable, with maximum parallelism within phases.

**Total estimated effort:** ~45-55 engineering-weeks (AI-agent accelerated)

### 1.2 Major Phases

| Phase | Name | Duration | Parallelizable |
|-------|------|----------|----------------|
| 1 | Environment & Project Setup | 1 week | Yes (infra + scaffolding) |
| 2 | Core Infrastructure | 2 weeks | Partial (state store ↔ auth parallel) |
| 3 | Core Business Logic | 3 weeks | Partial (engine ↔ connectors parallel) |
| 4 | API Layer | 2 weeks | Yes (routes can parallelize) |
| 5 | Frontend Canvas | 3 weeks | Yes (components can parallelize) |
| 6 | Integrations & Security | 2 weeks | Yes (egress ↔ secrets ↔ observability) |
| 7 | Testing & Deployment | 2 weeks | Partial |

### 1.3 Critical Path

```
Project Setup → State Store → Workflow Authoring → Execution Engine → API Routes → Frontend Canvas → E2E Tests
```

### 1.4 Parallel Workstreams

- **Stream A (Backend Core):** State Store → Auth → Workflow Authoring → Engine
- **Stream B (Connectors):** Connector Interface → Vault/Desk/Recap Adapters → LLM Providers
- **Stream C (Frontend):** Canvas Shell → Node Library → Config Panel → Execution Monitor
- **Stream D (Security/Ops):** Egress → Secrets → Observability → Deployment

---

## 2. Task Breakdown Structure

### Epic 1: INFRA — Project Setup & Infrastructure

Foundation for all development: monorepo, build system, CI/CD, Docker, database migrations.

### Epic 2: CORE — Core Backend Services

State store abstraction, authentication, configuration, API gateway skeleton, RBAC middleware.

### Epic 3: ENGINE — Execution Engine

DAG scheduler, topological sort, state machine, retry logic, circuit breaker, node handlers (branch, loop, parallel, approval, delay).

### Epic 4: CONN — Connectors & Integrations

Connector registry, adapter interface, ODW agent connectors (Vault, Desk, Recap), LLM provider abstraction, notification channels.

### Epic 5: TRIG — Triggers & Event System

Trigger dispatcher, cron scheduler, webhook ingress, ODW event listener, manual trigger.

### Epic 6: FE — Frontend Canvas Application

React SPA with React Flow canvas, node library, config panels, execution monitor, admin panel, metrics dashboard.

### Epic 7: SEC — Security, Egress & Observability

Encryption, egress policy engine, sandbox runtime, audit logging, Prometheus metrics, OpenTelemetry, alerting.

---

## 3. Task Definitions

### Epic 1: INFRA — Project Setup & Infrastructure

---

#### INFRA-001: Monorepo Scaffolding

**Description:** Initialize pnpm workspace monorepo with TypeScript project references. Create root configuration files and directory structure matching TSD §17.

**Inputs:** TSD §3 (Tech Stack), TSD §17 (File Structure), TSD §18 (Coding Standards)

**Output:**
- `package.json` (root workspace)
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.eslintrc.js`, `.prettierrc`
- `vitest.config.ts`
- Directory structure: `apps/`, `packages/`, `migrations/`, `helm/`, `templates/`, `docs/`, `tests/`
- Empty `package.json` in each workspace package

**Acceptance Criteria:**
- `pnpm install` succeeds with zero errors
- `pnpm typecheck` passes (empty projects)
- All workspace packages resolve correctly
- ESLint and Prettier configs enforce TSD §18 conventions

**Dependencies:** None

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** S (2-4 hours)

---

#### INFRA-002: Shared TypeScript Configuration

**Description:** Create per-package `tsconfig.json` files extending the base config. Set up project references for inter-package dependencies.

**Inputs:** TSD §18.5 (TypeScript Configuration)

**Output:**
- `apps/api/tsconfig.json`
- `apps/canvas/tsconfig.json`
- `apps/sandbox/tsconfig.json`
- `apps/control-plane/tsconfig.json`
- `packages/*/tsconfig.json` (one per package)
- All with correct `references` arrays

**Acceptance Criteria:**
- `tsc --build` succeeds from root
- Each package compiles independently
- Cross-package imports resolve via project references
- Strict mode enabled everywhere per TSD §18.5

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** S

---

#### INFRA-003: Docker & Docker Compose Setup

**Description:** Create Dockerfiles for app, sandbox, and control-plane. Create docker-compose.yml for Core tier development and production.

**Inputs:** TSD §15.2 (Dockerfile Requirements), TSD §15.4 (Docker Compose)

**Output:**
- `docker/Dockerfile.app` (multi-stage: build + runtime)
- `docker/Dockerfile.sandbox` (gVisor-based)
- `docker/Dockerfile.controlplane`
- `docker-compose.yml` (Core tier production)
- `docker-compose.dev.yml` (development with hot reload)
- `.dockerignore`

**Acceptance Criteria:**
- `docker compose build` succeeds for all services
- `docker compose up` starts loop-app on port 3000
- Health check endpoint responds
- Sandbox container uses gVisor runtime
- Non-root user in production images

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M (4-8 hours)

---

#### INFRA-004: CI/CD Pipeline Configuration

**Description:** Set up GitHub Actions workflow for PR checks and main branch deployment.

**Inputs:** TSD §15.5 (CI/CD Pipeline)

**Output:**
- `.github/workflows/ci.yml` (PR checks: install, typecheck, lint, test:unit, test:integration, audit, docker build)
- `.github/workflows/release.yml` (main merge: build, tag, push, helm update, release notes)

**Acceptance Criteria:**
- PR workflow runs all 7 checks from TSD §15.5
- Release workflow triggers on merge to main
- Docker image tagged with semver on release
- All checks must pass before merge

**Dependencies:** INFRA-001, INFRA-003

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** M

---

#### INFRA-005: Database Migration Framework

**Description:** Set up Drizzle Kit for schema migrations. Create initial migration with all tables from TSD §4.

**Inputs:** TSD §4 (Data Modeling), TSD §4.12 (Migration Strategy)

**Output:**
- `packages/state/src/migrations/001_initial_schema.ts`
- `drizzle.config.ts`
- Migration runner utility (`packages/state/src/migrate.ts`)
- Schema definitions for all 9 entities (workflows, workflow_definitions, workflow_executions, node_executions, workflow_triggers, audit_events, users, secrets, egress_policies, connectors)
- All indexes as specified in TSD §4

**Acceptance Criteria:**
- Migration applies cleanly on fresh SQLite database
- Migration applies cleanly on fresh PostgreSQL database
- All tables, columns, constraints, and indexes match TSD §4
- `schema_migrations` tracking table created
- Idempotent re-run produces no errors

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L (8-16 hours)

---

#### INFRA-006: Environment Configuration Module

**Description:** Create centralized configuration loader using Zod for validation. Load all environment variables from TSD §10.

**Inputs:** TSD §10 (Configuration & Environment Variables)

**Output:**
- `apps/api/src/config.ts` — Zod schema + loader for all LOOP_* variables
- `apps/sandbox/src/config.ts` — Sandbox-specific config
- `apps/control-plane/src/config.ts` — Control plane config
- `.env.example` with all variables documented
- `.env.test` for test environment

**Acceptance Criteria:**
- All variables from TSD §10.1–10.11 defined with types and defaults
- Invalid config fails fast with clear error messages
- Dev/prod/test profiles work correctly
- No hardcoded secrets in source

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### INFRA-007: Logging Infrastructure

**Description:** Set up Pino structured logging with correlation IDs and log levels per TSD §12.

**Inputs:** TSD §12.3 (Logging Format), TSD §12.4 (Correlation IDs), TSD §16.2 (Logs to Emit)

**Output:**
- `packages/observability/src/logger.ts` — Pino logger factory
- `packages/observability/src/correlation.ts` — Request ID generation and propagation
- Log format matches TSD §12.3 JSON structure
- Log rotation configuration

**Acceptance Criteria:**
- All logs output structured JSON
- request_id, execution_id, node_execution_id propagated correctly
- Log levels configurable via LOOP_LOG_LEVEL
- Performance: logging adds < 1ms overhead per log call

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** S

---

### Epic 2: CORE — Core Backend Services

---

#### CORE-001: State Store Interface & SQLite Implementation

**Description:** Implement `@loop/state` package with abstract interface and SQLite adapter. Drizzle ORM for query building.

**Inputs:** TSD §4 (Data Models), TSD §7.1 (Stateless vs Stateful), TSD §3.4 (Data Layer)

**Output:**
- `packages/state/src/interface.ts` — Abstract StateStore interface with methods for all entities
- `packages/state/src/sqlite/index.ts` — SQLite adapter
- `packages/state/src/sqlite/connection.ts` — SQLite connection with WAL mode
- `packages/state/src/sqlite/workflows.ts` — Workflow CRUD
- `packages/state/src/sqlite/executions.ts` — Execution CRUD
- `packages/state/src/sqlite/triggers.ts` — Trigger CRUD
- `packages/state/src/sqlite/users.ts` — User CRUD
- `packages/state/src/sqlite/secrets.ts` — Secret CRUD
- `packages/state/src/sqlite/egress.ts` — Egress policy CRUD
- `packages/state/src/sqlite/connectors.ts` — Connector CRUD
- `packages/state/src/sqlite/audit.ts` — Audit event append-only writer

**Acceptance Criteria:**
- All CRUD operations work against in-memory SQLite
- WAL mode enabled
- Pagination support (page, per_page, total)
- Filtering and sorting per TSD §5.3
- Full-text search on workflows (name + description)
- Parameterized queries only (no SQL injection)

**Dependencies:** INFRA-005

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### CORE-002: PostgreSQL State Store Adapter

**Description:** Implement PostgreSQL adapter for `@loop/state` for Scale tier.

**Inputs:** TSD §3.4 (Data Layer), TSD §4 (Data Models)

**Output:**
- `packages/state/src/postgres/index.ts` — PostgreSQL adapter
- `packages/state/src/postgres/connection.ts` — Connection pool (10-50 connections)
- `packages/state/src/postgres/*.ts` — Entity-specific implementations (same interface as SQLite)
- `packages/state/src/postgres/migrations.ts` — PostgreSQL-specific migration handling

**Acceptance Criteria:**
- Same interface as SQLite adapter (drop-in replacement)
- Connection pooling works correctly
- GIN indexes for JSONB and full-text search
- SSL support (LOOP_DB_SSL=true)
- Passes same test suite as SQLite adapter

**Dependencies:** CORE-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** L

---

#### CORE-003: Authentication Service

**Description:** Implement JWT-based authentication with login, token refresh, and API key support.

**Inputs:** TSD §11.1 (Authentication Flow), TSD §11.3 (Token Structure), TSD §5.1 (Auth)

**Output:**
- `apps/api/src/routes/auth.ts` — Login, refresh, API key endpoints
- `packages/auth/src/jwt.ts` — JWT generation and validation (jose library)
- `packages/auth/src/apikey.ts` — API key generation, hashing, validation
- `packages/auth/src/password.ts` — bcrypt password hashing and comparison
- `packages/auth/src/middleware.ts` — Auth middleware (Bearer token + API key)

**Acceptance Criteria:**
- Login returns access token (15min TTL) + refresh token (7d TTL)
- Token payload matches TSD §11.3 structure
- Refresh endpoint validates refresh token and issues new access token
- API key format: `loop_<scope>_<random-32-chars>`
- API key stored as SHA-256 hash
- Expired tokens return 401 AUTH_EXPIRED
- Invalid tokens return 401 AUTH_INVALID_TOKEN

**Dependencies:** CORE-001, INFRA-006

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### CORE-004: RBAC Middleware

**Description:** Implement role-based access control middleware enforcing permission matrix from TSD §11.2.

**Inputs:** TSD §11.2 (Authorization Model)

**Output:**
- `apps/api/src/middleware/rbac.ts` — RBAC enforcement middleware
- `packages/auth/src/permissions.ts` — Permission matrix definition
- Permission decorator for route handlers

**Acceptance Criteria:**
- Read role: can view workflows, executions, audit logs
- Write role: can create/edit/execute workflows, manage triggers, export data
- Admin role: full access including connectors, secrets, users, egress, system config
- Returns 403 FORBIDDEN_INSUFFICIENT_ROLE on violation
- Permission check is O(1) per request

**Dependencies:** CORE-003

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** S

---

#### CORE-005: API Gateway Skeleton

**Description:** Set up Fastify server with middleware chain, error handling, rate limiting, CORS, and response envelope.

**Inputs:** TSD §5.2 (Response Envelope), TSD §12.1 (Error Format), TSD §12.2 (Error Categories)

**Output:**
- `apps/api/src/server.ts` — Fastify server entry point
- `apps/api/src/middleware/errorHandler.ts` — Global error handler with standard envelope
- `apps/api/src/middleware/rateLimit.ts` — Token bucket rate limiter
- `apps/api/src/middleware/cors.ts` — CORS configuration
- `apps/api/src/middleware/requestId.ts` — Request ID generation
- Standard response envelope helper functions

**Acceptance Criteria:**
- All responses use standard envelope (success, data/error, meta)
- Error responses include request_id, timestamp, error code, message, details
- Rate limiting: configurable per user/endpoint
- CORS: configurable origins
- Server starts and responds to /health within 10s cold start
- All error categories from TSD §12.2 mapped to correct HTTP status codes

**Dependencies:** INFRA-006, INFRA-007, CORE-003, CORE-004

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### CORE-006: Workflow Authoring Service

**Description:** Implement workflow CRUD operations with topology validation, versioning, and git-backed history.

**Inputs:** TSD §5.3 (Workflow Endpoints), TSD §6.6 (Validation Rules), TSD §7.4 (Authoring Data Flow)

**Output:**
- `packages/workflow-authoring/src/service.ts` — Workflow CRUD (create, read, update, delete, list)
- `packages/workflow-authoring/src/validator.ts` — Topology validation (6 rules from TSD §6.6)
- `packages/workflow-authoring/src/topology.ts` — Graph operations (cycle detection, reachability)
- `packages/versioning/src/service.ts` — Version management (increment, snapshot, restore)
- `packages/versioning/src/git.ts` — Git operations via isomorphic-git
- `packages/versioning/src/diff.ts` — Version diff generation

**Acceptance Criteria:**
- Create workflow: validates definition, assigns UUID, sets version=1, status=draft
- Update workflow: validates topology, increments version, creates git commit
- Delete: soft-delete (status → archived)
- Validation catches: orphan nodes, cycles, port incompatibility, missing config, unresolvable variables
- Version history: list versions with commit hashes
- Restore: creates new version from historical definition
- Git operations: commit, log, checkout (isomorphic-git)

**Dependencies:** CORE-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### CORE-007: WebSocket Server for Execution Updates

**Description:** Implement WebSocket endpoint for real-time execution progress streaming.

**Inputs:** TSD §5.8 (WebSocket)

**Output:**
- `apps/api/src/websocket/executionStream.ts` — WebSocket handler
- Connection authentication (JWT in first message or query param)
- Message types: node_started, node_completed, execution_completed
- Connection lifecycle management (connect, disconnect, error)

**Acceptance Criteria:**
- Client connects via WS /ws/executions/:execution_id
- Receives node_started, node_completed, execution_completed messages
- Authentication required (reject unauthenticated connections)
- Clean disconnect handling
- Multiple clients can subscribe to same execution
- Message format matches TSD §5.8

**Dependencies:** CORE-005

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

### Epic 3: ENGINE — Execution Engine

---

#### ENGINE-001: Topological Sort & DAG Scheduler

**Description:** Implement DAG parsing, topological sort (Kahn's algorithm), and execution scheduling.

**Inputs:** TSD §6.2 (Topological Sort Algorithm), TSD §6.1 (Execution Flow)

**Output:**
- `packages/engine/src/scheduler.ts` — Topological sort + level-based scheduling
- `packages/engine/src/dag.ts` — DAG parsing from workflow definition JSON
- `packages/engine/src/types.ts` — Engine type definitions (Node, Edge, ExecutionPlan)

**Acceptance Criteria:**
- Topological sort produces correct execution order
- Cycle detection throws WorkflowValidationError
- Parallel nodes at same topological level identified for concurrent execution
- Empty workflow (no nodes) → immediately succeeds
- 200-node workflow sorts in < 50ms
- Branch/loop/parallel control nodes handled correctly in ordering

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### ENGINE-002: Execution State Machine

**Description:** Implement execution lifecycle state machine with valid transitions.

**Inputs:** TSD §6.1 (Execution Flow), TSD §4.3 (workflow_executions status enum)

**Output:**
- `packages/engine/src/stateMachine.ts` — State machine with transitions
- States: pending → running → succeeded/failed/cancelled/paused
- Node states: pending → running → succeeded/failed/skipped
- Transition validation (illegal transitions throw)
- Event emission on state changes

**Acceptance Criteria:**
- Valid transitions enforced (e.g., cannot go from succeeded back to running)
- Cancel from running/paused → cancelled
- Pause from running → paused (for approval nodes)
- Resume from paused → running
- All state changes emit events for observability
- Thread-safe for concurrent execution updates

**Dependencies:** ENGINE-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### ENGINE-003: Main Execution Executor

**Description:** Implement the core execution loop that processes nodes in topological order, handles branching, parallelism, and loops.

**Inputs:** TSD §6.1 (Workflow Execution Flow — full step-by-step)

**Output:**
- `packages/engine/src/executor.ts` — Main execution loop
- Execution context management (variables, trigger payload)
- Variable interpolation engine (`{{variable}}` substitution)
- Input resolution and type coercion
- Node dispatch to appropriate handler
- Result collection and output storage

**Acceptance Criteria:**
- Executes nodes in topological order
- Variable interpolation resolves `{{trigger.payload.*}}` and `{{node_N.output.*}}`
- Input validated against node's input_schema before execution
- Output stored in node_executions table
- Execution context passed between nodes correctly
- Concurrent execution limit respected (LOOP_MAX_CONCURRENT)
- Workflow-level timeout enforced
- Empty workflow succeeds immediately

**Dependencies:** ENGINE-001, ENGINE-002, CORE-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### ENGINE-004: Retry Logic

**Description:** Implement configurable retry with exponential, linear, and fixed backoff strategies.

**Inputs:** TSD §6.3 (Retry Logic)

**Output:**
- `packages/engine/src/retry.ts` — Retry wrapper with backoff calculation
- Backoff strategies: exponential, linear, fixed
- Configurable max_attempts, initial_delay_ms per node
- Default retry config from LOOP_DEFAULT_RETRY_COUNT/BACKOFF

**Acceptance Criteria:**
- Retries up to max_attempts times
- Exponential backoff: baseDelay * 2^attempt
- Linear backoff: baseDelay * (attempt + 1)
- Fixed backoff: constant delay
- Last error thrown after all retries exhausted
- Retry count tracked in node_executions.retry_count
- Jitter support (optional, ±10%)

**Dependencies:** ENGINE-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** S

---

#### ENGINE-005: Circuit Breaker

**Description:** Implement circuit breaker pattern for external service calls.

**Inputs:** TSD §6.5 (Circuit Breaker State Machine)

**Output:**
- `packages/engine/src/circuitBreaker.ts` — Circuit breaker implementation
- States: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
- Per-connector circuit breaker instances
- Configurable threshold (default: 5 failures), cooldown (default: 30s)
- Metrics integration (loop_circuit_breaker_state)

**Acceptance Criteria:**
- CLOSED: requests pass through normally
- OPEN after consecutive_failures >= threshold: all requests fail immediately
- HALF_OPEN after cooldown_period: one test request allowed
- Transitions to CLOSED on test success, back to OPEN on test failure
- State exposed via metrics (0=closed, 1=open, 2=half-open)
- Per-connector isolation (one connector's failures don't affect others)

**Dependencies:** INFRA-007

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### ENGINE-006: Control Flow Node Handlers

**Description:** Implement built-in control flow nodes: branch, loop, parallel, approval, delay.

**Inputs:** TSD §6.1 (Decision branches), TSD §4.11 (Workflow Definition Schema)

**Output:**
- `packages/engine/src/nodes/branch.ts` — Conditional branching
- `packages/engine/src/nodes/loop.ts` — Loop iteration with condition
- `packages/engine/src/nodes/parallel.ts` — Fan-out/fan-in parallel execution
- `packages/engine/src/nodes/approval.ts` — Human-in-the-loop approval (pauses execution)
- `packages/engine/src/nodes/delay.ts` — Timed delay

**Acceptance Criteria:**
- Branch: evaluates condition expression, selects correct branch path
- Loop: iterates body while condition true, exits on false
- Parallel: executes all branches concurrently, waits for all to complete (fan-in)
- Approval: pauses execution, waits for approve/reject API call, resumes or fails
- Delay: pauses for configured duration, then continues
- All control nodes emit appropriate observability events

**Dependencies:** ENGINE-003, ENGINE-002

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### ENGINE-007: Execution Recovery (Core Tier)

**Description:** Implement startup recovery for interrupted executions.

**Inputs:** TSD §8.4 (Execution State Recovery)

**Output:**
- `packages/engine/src/recovery.ts` — Recovery logic on application startup
- Query in-flight executions from previous run
- Resume from last successful node or mark as failed

**Acceptance Criteria:**
- On startup, queries executions with status='running' from before shutdown
- Recoverable executions re-queued from last successful node
- Non-recoverable marked as 'failed' with "Interrupted by system restart"
- Idempotent (safe to run multiple times)
- Runs once on startup only

**Dependencies:** ENGINE-003, CORE-001

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** M

---

### Epic 4: CONN — Connectors & Integrations

---

#### CONN-001: Connector Interface & Registry

**Description:** Define the connector adapter interface and implement the connector registry.

**Inputs:** TSD §2.2 (@loop/connectors), TSD §5.6 (Connector Endpoints)

**Output:**
- `packages/connectors/src/interface.ts` — ConnectorAdapter interface (execute, healthCheck, getCapabilities)
- `packages/connectors/src/registry.ts` — Connector registry (register, get, list, health check)
- `packages/connectors/src/types.ts` — Connector type definitions
- Capability discovery system

**Acceptance Criteria:**
- Interface defines: execute(input) → output, healthCheck() → boolean, getCapabilities() → NodeType[]
- Registry supports dynamic registration of connector types
- Each connector instance has unique ID, type, config, status
- Health check runs periodically (every 30s per TSD §8.2)
- Capabilities cached for 5 minutes (TSD §7.2)

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### CONN-002: Vault Connector Adapter

**Description:** Implement adapter for ODW Vault agent (knowledge base operations).

**Inputs:** TSD §9.1 (ODW Vault)

**Output:**
- `packages/connectors/src/vault/adapter.ts` — Vault adapter implementation
- `packages/connectors/src/vault/types.ts` — Vault-specific types
- `packages/connectors/src/vault/operations.ts` — CRUD documents, search, RAG queries, tag management

**Acceptance Criteria:**
- Implements ConnectorAdapter interface
- Operations: create_document, update_document, delete_document, search, rag_query, manage_tags
- Authentication via API key or mTLS
- Rate limiting respected (100 req/s default)
- Circuit breaker integration
- Error handling with UPSTREAM_VAULT_UNAVAILABLE on failure

**Dependencies:** CONN-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### CONN-003: Desk Connector Adapter

**Description:** Implement adapter for ODW Desk agent (workspace operations).

**Inputs:** TSD §9.2 (ODW Desk)

**Output:**
- `packages/connectors/src/desk/adapter.ts` — Desk adapter implementation
- `packages/connectors/src/desk/types.ts` — Desk-specific types
- `packages/connectors/src/desk/operations.ts` — Tasks, projects, calendar, notifications

**Acceptance Criteria:**
- Operations: create_task, update_task, complete_task, create_project, create_calendar_event, send_notification
- Implements ConnectorAdapter interface
- Authentication via API key or mTLS
- Circuit breaker integration

**Dependencies:** CONN-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### CONN-004: Recap Connector Adapter

**Description:** Implement adapter for ODW Recap agent (meeting intelligence).

**Inputs:** TSD §9.3 (ODW Recap)

**Output:**
- `packages/connectors/src/recap/adapter.ts` — Recap adapter implementation
- `packages/connectors/src/recap/types.ts` — Recap-specific types
- `packages/connectors/src/recap/operations.ts` — Ingest transcripts, extract action items, summarize, classify

**Acceptance Criteria:**
- Operations: ingest_transcript, extract_action_items, summarize, classify, get_transcript
- Implements ConnectorAdapter interface
- Event subscription for transcript.completed, extraction.completed
- Circuit breaker integration

**Dependencies:** CONN-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### CONN-005: Generic Agent Connector

**Description:** Implement generic connector for arbitrary ODW agents or REST APIs.

**Inputs:** TSD §9 (External Integrations — general pattern)

**Output:**
- `packages/connectors/src/generic/adapter.ts` — Generic REST adapter
- `packages/connectors/src/generic/config.ts` — Configurable endpoint, auth, headers

**Acceptance Criteria:**
- Configurable base URL, authentication method, headers
- Supports any REST API with JSON request/response
- Maps to configurable node types
- Health check via configurable endpoint

**Dependencies:** CONN-001

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** S

---

#### CONN-006: LLM Provider Abstraction Layer

**Description:** Implement model-agnostic LLM provider interface with fallback chain.

**Inputs:** TSD §3.3 (AI/ML Stack), TSD §9.4 (LLM Providers)

**Output:**
- `packages/llm/src/interface.ts` — LLMProvider interface (complete, embed, stream)
- `packages/llm/src/ollama.ts` — Ollama provider
- `packages/llm/src/vllm.ts` — vLLM provider
- `packages/llm/src/openai.ts` — OpenAI provider
- `packages/llm/src/anthropic.ts` — Anthropic provider
- `packages/llm/src/azure.ts` — Azure OpenAI provider
- `packages/llm/src/bedrock.ts` — AWS Bedrock provider
- `packages/llm/src/vertex.ts` — Google Vertex provider
- `packages/llm/src/router.ts` — Provider routing with fallback chain

**Acceptance Criteria:**
- All 7 providers implement same interface
- Router tries providers in LOOP_LLM_FALLBACK_CHAIN order
- Circuit breaker per provider
- Configurable per-workflow, per-node model selection
- Prompt template engine with variable interpolation
- Streaming support where provider allows

**Dependencies:** INFRA-006

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** L

---

#### CONN-007: Notification Connectors

**Description:** Implement Slack, Email (SMTP), and generic webhook notification channels.

**Inputs:** TSD §9.6 (Notification Channels)

**Output:**
- `packages/connectors/src/notification/slack.ts` — Slack notification adapter
- `packages/connectors/src/notification/email.ts` — SMTP email adapter
- `packages/connectors/src/notification/webhook.ts` — Generic webhook notification adapter
- `packages/connectors/src/notification/queue.ts` — Notification queue with retry

**Acceptance Criteria:**
- Slack: posts messages via chat.postMessage API
- Email: sends via SMTP with configurable server/auth
- Webhook: POST with HMAC signature
- Retry with exponential backoff: 5s, 30s, 5min, 30min (TSD §8.5)
- Max 4 retries then drop with alert
- Idempotency key in payload

**Dependencies:** CONN-001

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** M

---

#### CONN-008: Semantic Type System

**Description:** Implement `@loop/types` — shared type registry with Zod schemas, validation, and coercion.

**Inputs:** TSD §4.11 (Workflow Definition Schema), TSD §2.2 (@loop/types)

**Output:**
- `packages/types/src/registry.ts` — Type registry (register, get, list types)
- `packages/types/src/schemas/document.ts` — Document type schema
- `packages/types/src/schemas/transcript.ts` — Transcript type schema
- `packages/types/src/schemas/actionItem.ts` — ActionItem type schema
- `packages/types/src/schemas/task.ts` — Task type schema
- `packages/types/src/schemas/calendarEvent.ts` — CalendarEvent type schema
- `packages/types/src/validator.ts` — Runtime type validation
- `packages/types/src/coercion.ts` — Type coercion/transformation rules
- Port compatibility checking

**Acceptance Criteria:**
- All semantic types defined with Zod schemas
- Type validation at runtime (node input/output)
- Port compatibility: source output type compatible with target input type
- Type coercion rules (e.g., string → number, array → single item)
- Custom types registerable by connectors

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

### Epic 5: TRIG — Triggers & Event System

---

#### TRIG-001: Trigger Dispatcher

**Description:** Implement trigger matching engine that routes events to workflows.

**Inputs:** TSD §6.1 (Trigger flow steps 1-3), TSD §4.5 (workflow_triggers)

**Output:**
- `packages/triggers/src/dispatcher.ts` — Trigger matching and dispatch
- Event → trigger matching logic
- Execution creation on match
- Concurrency limit check

**Acceptance Criteria:**
- Matches incoming events against registered triggers
- Creates WorkflowExecution record for each match
- Emits 'execution.created' event
- Respects concurrency limits
- Handles multiple triggers matching same event

**Dependencies:** CORE-001, ENGINE-002

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### TRIG-002: Cron Trigger Handler

**Description:** Implement cron-based trigger scheduling.

**Inputs:** TSD §4.5 (cron config), TSD §8.1 (Background Jobs)

**Output:**
- `packages/triggers/src/cron.ts` — Cron scheduler using node-cron
- Cron expression validation
- Timezone support
- Job lifecycle management (start, stop, reschedule)

**Acceptance Criteria:**
- Parses standard cron expressions (5-field)
- Timezone support (config per trigger)
- Fires trigger at scheduled times
- Survives application restart (re-registers on startup)
- Invalid expressions rejected at creation time

**Dependencies:** TRIG-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** S

---

#### TRIG-003: Webhook Trigger Handler

**Description:** Implement webhook ingress with HMAC signature verification.

**Inputs:** TSD §5.7 (Webhook Ingress), TSD §11.6 (Webhook Security)

**Output:**
- `packages/triggers/src/webhook.ts` — Webhook handler
- `apps/api/src/routes/webhooks.ts` — POST /webhooks/:trigger_id endpoint
- HMAC-SHA256 signature verification
- Replay protection (timestamp check)
- Rate limiting per webhook (60 events/min)

**Acceptance Criteria:**
- POST /webhooks/:trigger_id accepts arbitrary JSON
- X-Loop-Signature header verified (HMAC-SHA256)
- Rejects if signature invalid (401)
- Rejects if timestamp > 5 minutes old (replay protection)
- Rate limited: 60 events/minute per trigger (429)
- Returns { accepted: true, execution_id: uuid }
- Unknown trigger → 404

**Dependencies:** TRIG-001, CORE-005

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### TRIG-004: Event Trigger Handler (ODW Agent Events)

**Description:** Implement event listener for ODW agent events (Vault, Desk, Recap).

**Inputs:** TSD §9.1-9.3 (Events), TSD §4.5 (event config)

**Output:**
- `packages/triggers/src/event.ts` — Event trigger handler
- Event subscription management
- Event filtering (source, event_type, custom filter)
- Event → trigger matching

**Acceptance Criteria:**
- Subscribes to events from configured ODW agents
- Filters by source (vault/desk/recap), event_type, custom filter
- Creates execution when matching event received
- Supports event types: document.created, transcript.completed, task.created, etc.
- Connection resilience (reconnect on disconnect)

**Dependencies:** TRIG-001, CONN-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### TRIG-005: Manual Trigger Handler

**Description:** Implement manual execution trigger via API.

**Inputs:** TSD §5.3 (POST /api/v1/workflows/:id/execute)

**Output:**
- `packages/triggers/src/manual.ts` — Manual trigger handler
- Integration with execution endpoint

**Acceptance Criteria:**
- POST /api/v1/workflows/:id/execute creates execution
- Accepts optional payload
- Returns 202 with execution_id
- Requires write/admin role

**Dependencies:** TRIG-001, CORE-005

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** S

---

### Epic 6: FE — Frontend Canvas Application

---

#### FE-001: React Application Shell

**Description:** Set up React 18 SPA with Vite, React Router, Zustand, Tailwind CSS, and i18n.

**Inputs:** TSD §3.2 (Frontend Stack), TSD §2.1 (loop-canvas)

**Output:**
- `apps/canvas/src/main.tsx` — React entry point
- `apps/canvas/src/App.tsx` — Root component with routing
- `apps/canvas/vite.config.ts` — Vite configuration
- `apps/canvas/tailwind.config.ts` — Tailwind configuration
- `apps/canvas/src/i18n/` — i18n setup (5 languages)
- `apps/canvas/src/api/client.ts` — ky-based API client
- `apps/canvas/src/stores/authStore.ts` — Auth state management
- Route structure: /, /workflows, /workflows/:id, /executions, /admin

**Acceptance Criteria:**
- `pnpm dev` starts dev server with HMR
- `pnpm build` produces optimized production bundle
- Routing works for all defined routes
- Auth store manages JWT token lifecycle
- API client includes auth headers automatically
- Tailwind styles applied correctly
- i18n loads correct language

**Dependencies:** INFRA-001

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### FE-002: Canvas Editor (React Flow)

**Description:** Implement the visual workflow builder using React Flow with custom nodes and edges.

**Inputs:** TSD §2.1 (CanvasEditor), TSD §4.11 (Workflow Definition Schema)

**Output:**
- `apps/canvas/src/components/canvas/CanvasEditor.tsx` — Main canvas component
- `apps/canvas/src/components/canvas/nodes/` — Custom node types (connector, control, code)
- `apps/canvas/src/components/canvas/edges/` — Custom edge types (standard, conditional)
- `apps/canvas/src/stores/workflowStore.ts` — Workflow state (Zustand)
- Drag-and-drop from NodeLibrary to canvas
- Pan, zoom, minimap
- Undo/redo support
- Auto-layout option

**Acceptance Criteria:**
- Renders workflow definition as node-and-edge graph
- Nodes draggable, edges connectable
- Custom node types render with correct icons/colors per connector type
- Port compatibility visual feedback (green = compatible, red = incompatible)
- Selection, multi-select, copy/paste, delete
- Canvas state persisted to workflowStore
- Performance: smooth with 200 nodes

**Dependencies:** FE-001, CONN-008

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### FE-003: Node Library & Config Panel

**Description:** Implement searchable node palette and per-node configuration form.

**Inputs:** TSD §2.1 (NodeLibrary, NodeConfigPanel)

**Output:**
- `apps/canvas/src/components/canvas/NodeLibrary.tsx` — Categorized, searchable node palette
- `apps/canvas/src/components/canvas/NodeConfigPanel.tsx` — Dynamic config form per node type
- `apps/canvas/src/components/canvas/nodes/configSchemas.ts` — Form schemas per node type

**Acceptance Criteria:**
- Node library shows all available node types (connector nodes, control nodes, code nodes)
- Search/filter by name, category, connector
- Drag from library to canvas creates node
- Config panel shows when node selected
- Form fields generated from node's config schema (React Hook Form + Zod)
- Variable picker for `{{variable}}` references
- Config changes reflected in workflow definition

**Dependencies:** FE-002

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** L

---

#### FE-004: Execution Monitor

**Description:** Implement real-time execution progress view with WebSocket integration.

**Inputs:** TSD §2.1 (ExecutionMonitor), TSD §5.8 (WebSocket)

**Output:**
- `apps/canvas/src/components/executions/ExecutionMonitor.tsx` — Real-time execution view
- `apps/canvas/src/components/executions/ExecutionList.tsx` — Execution history list
- `apps/canvas/src/components/executions/ExecutionDetail.tsx` — Single execution detail
- `apps/canvas/src/stores/executionStore.ts` — Execution state management
- WebSocket client for live updates

**Acceptance Criteria:**
- Shows execution progress in real-time (node-by-node)
- Color-coded node status (pending=gray, running=blue, succeeded=green, failed=red)
- Input/output data visible per node
- Execution timeline with duration per node
- Cancel button for running executions
- Approve/reject for paused executions
- Execution list with filtering (status, workflow, date range)

**Dependencies:** FE-001, CORE-007

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** L

---

#### FE-005: Metrics Dashboard

**Description:** Implement metrics visualization with charts.

**Inputs:** TSD §2.1 (MetricsDashboard), TSD §16.1 (Metrics)

**Output:**
- `apps/canvas/src/components/dashboard/MetricsDashboard.tsx` — Dashboard layout
- `apps/canvas/src/components/dashboard/ExecutionCharts.tsx` — Execution metrics charts
- `apps/canvas/src/components/dashboard/ConnectorCharts.tsx` — Connector health charts
- Recharts-based visualizations

**Acceptance Criteria:**
- Success rate chart (time series)
- Execution duration histogram
- Throughput chart (executions/hour)
- Connector call latency chart
- Error rate by node type
- Date range selector
- Auto-refresh (configurable interval)

**Dependencies:** FE-001

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** M

---

#### FE-006: Admin Panel

**Description:** Implement admin settings UI for RBAC, secrets, egress policies, system config.

**Inputs:** TSD §2.1 (AdminPanel)

**Output:**
- `apps/canvas/src/components/admin/AdminPanel.tsx` — Admin layout
- `apps/canvas/src/components/admin/UserManagement.tsx` — User CRUD, role assignment
- `apps/canvas/src/components/admin/SecretsManager.tsx` — Secret CRUD
- `apps/canvas/src/components/admin/EgressPolicies.tsx` — Egress rule management
- `apps/canvas/src/components/admin/SystemConfig.tsx` — System settings
- `apps/canvas/src/components/admin/DataFlowMap.tsx` — Visual graph of external endpoints

**Acceptance Criteria:**
- User management: create, edit, deactivate users; assign roles
- Secrets: create, edit, delete secrets (value hidden after creation)
- Egress: create allow/deny rules for domains, IP ranges, regions
- System config: view/edit runtime configuration
- DataFlowMap: visual graph showing all external endpoints contacted
- All admin actions require admin role
- Audit trail for admin actions

**Dependencies:** FE-001

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** L

---

#### FE-007: Workflow Templates & Import/Export

**Description:** Implement workflow template gallery and JSON import/export.

**Inputs:** TSD §19.2 C11 (Workflow portability)

**Output:**
- `apps/canvas/src/components/templates/TemplateGallery.tsx` — Template browser
- Import/export functionality (JSON download/upload)
- Bundled templates from `/templates/` directory

**Acceptance Criteria:**
- Gallery shows bundled templates (meeting-to-tasks, research-summarize, document-ingestion)
- One-click template → new workflow
- Export workflow as JSON file
- Import JSON file → new workflow (with validation)
- Templates portable across deployments

**Dependencies:** FE-002

**Execution Type:** AI-Agent

**Priority:** Low

**Effort:** M

---

### Epic 7: SEC — Security, Egress & Observability

---

#### SEC-001: Encryption Module

**Description:** Implement AES-256-GCM encryption for execution I/O and secrets at rest.

**Inputs:** TSD §11.4 (Data Encryption Strategy)

**Output:**
- `packages/secrets/src/encryption.ts` — AES-256-GCM encrypt/decrypt
- Key derivation via HKDF from LOOP_ENCRYPTION_KEY
- Per-field IV generation and storage
- Separate encryption contexts for execution data and secrets

**Acceptance Criteria:**
- Encrypt/decrypt round-trip preserves data exactly
- Each encrypted field has unique IV
- Key derivation uses HKDF (not raw key)
- Performance: < 1ms per 1KB payload
- Encrypted data stored as { ciphertext, iv, tag } structure

**Dependencies:** INFRA-006

**Execution Type:** AI-Agent

**Priority:** Critical

**Effort:** M

---

#### SEC-002: Secrets Manager

**Description:** Implement encrypted secret storage with scope-based access.

**Inputs:** TSD §4.8 (secrets entity), TSD §11.4 (Encryption)

**Output:**
- `packages/secrets/src/manager.ts` — Secret CRUD with encryption
- `packages/secrets/src/vault.ts` — HashiCorp Vault integration (Scale tier)
- Scope support: global, workflow, connector

**Acceptance Criteria:**
- Create/read/update/delete secrets
- Values encrypted at rest (AES-256-GCM)
- Scope enforcement (workflow secrets only accessible within that workflow)
- Secret names unique within scope
- HashiCorp Vault integration for Scale tier (optional)
- Audit logging on secret access

**Dependencies:** SEC-001, CORE-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### SEC-003: Egress Policy Engine

**Description:** Implement network egress policy evaluation with domain, IP, and region matching.

**Inputs:** TSD §6.4 (Egress Policy Evaluation), TSD §4.9 (egress_policies)

**Output:**
- `packages/egress/src/engine.ts` — Policy evaluation engine
- `packages/egress/src/resolver.ts` — DNS resolution + IP geolocation
- `packages/egress/src/interceptor.ts` — Network call interceptor
- Policy cache with invalidation

**Acceptance Criteria:**
- Evaluates policies in priority order (highest first)
- Domain matching with wildcard support (*.example.com)
- IP range matching (CIDR notation)
- Region matching (IP geolocation lookup)
- Default: deny (secure by default)
- Air-gap mode: block all outbound (LOOP_AIRGAP_MODE=true)
- Blocked attempts logged and counted in metrics
- Policy changes invalidate cache immediately

**Dependencies:** CORE-001, INFRA-007

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** L

---

#### SEC-004: Code Node Sandbox

**Description:** Implement isolated code execution environment for user-written Python/TypeScript.

**Inputs:** TSD §2.3 (loop-sandbox), TSD §10.5 (Sandbox config)

**Output:**
- `apps/sandbox/src/server.ts` — Sandbox API server (gRPC or HTTP)
- `apps/sandbox/src/executor.ts` — Code execution logic
- `apps/sandbox/src/python/` — Python runtime wrapper
- `apps/sandbox/src/nodejs/` — Node.js runtime wrapper
- `apps/sandbox/src/network.ts` — Network policy enforcement
- `apps/sandbox/src/resources.ts` — Resource limit enforcement (CPU, memory)
- Sandbox pool management (pre-warmed instances)

**Acceptance Criteria:**
- Executes Python 3.11+ and Node.js code in isolation
- Resource limits enforced: memory (256MB default), CPU time (30s default)
- Network policy: only allowed endpoints accessible
- No host filesystem access
- No shell injection vectors
- Pool of pre-warmed sandboxes (configurable size)
- Cold start < 200ms for pooled sandbox
- stdout/stderr captured and returned
- Typed input/output via JSON serialization

**Dependencies:** INFRA-003, SEC-003

**Execution Type:** Developer (requires gVisor/Firecracker expertise)

**Priority:** High

**Effort:** L

---

#### SEC-005: Audit Logging

**Description:** Implement append-only audit event logging for all state-changing operations.

**Inputs:** TSD §4.6 (audit_events), TSD §8.3 (Audit Log Writer)

**Output:**
- `packages/audit/src/service.ts` — Audit event writer
- Integration hooks in all state-changing operations
- Audit log query API endpoint

**Acceptance Criteria:**
- Every state-changing operation writes audit event
- Events include: timestamp, actor, action, resource_type, resource_id, details, ip_address
- Append-only (no UPDATE/DELETE)
- Synchronous write (must succeed before operation returns)
- 3 immediate retries on write failure
- Query API with filtering (actor, action, resource, date range)

**Dependencies:** CORE-001

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### SEC-006: Prometheus Metrics

**Description:** Implement Prometheus metrics endpoint with all metrics from TSD §16.1.

**Inputs:** TSD §16.1 (Metrics), TSD §16.4 (Health Check Endpoints)

**Output:**
- `packages/observability/src/metrics.ts` — All metric definitions
- `apps/api/src/routes/system.ts` — /health, /ready, /metrics endpoints
- Metric registration and collection throughout the codebase

**Acceptance Criteria:**
- All 15 metrics from TSD §16.1 defined and collected
- /metrics endpoint returns Prometheus text format
- /health returns { status: "ok" } (200) or 503
- /ready checks DB connectivity, sandbox availability
- No auth required for metrics/health/ready endpoints
- Metric labels match TSD specification

**Dependencies:** INFRA-007, CORE-005

**Execution Type:** AI-Agent

**Priority:** High

**Effort:** M

---

#### SEC-007: OpenTelemetry Tracing (Scale Tier)

**Description:** Implement distributed tracing with OpenTelemetry for Scale tier.

**Inputs:** TSD §16.3 (Traces)

**Output:**
- `packages/observability/src/tracing.ts` — OpenTelemetry SDK setup
- Trace context propagation
- Span creation for executions, nodes, connector calls
- OTLP exporter configuration

**Acceptance Criteria:**
- Trace structure matches TSD §16.3 (execution → nodes → connector calls)
- Span attributes include loop.execution_id, workflow_id, node_id, etc.
- Configurable via LOOP_OTEL_ENABLED, LOOP_OTEL_ENDPOINT
- No-op when disabled (Core tier)
- Standard OpenTelemetry semantic conventions followed

**Dependencies:** SEC-006

**Execution Type:** AI-Agent

**Priority:** Medium

**Effort:** M

---

#### SEC-008: Alerting System

**Description:** Implement alert rule evaluation and notification dispatch.

**Inputs:** TSD §16.2 (Logs to Emit — alertable conditions), TSD §10.10 (Observability config)

**Output:**
- `packages/observability/src/alerting.ts` — Alert rule evaluation engine
- Configurable alert rules (error rate, latency, circuit breaker state)
- Notification dispatch via configured channels (Slack, webhook)

**Acceptance Criteria:**
- Alert rules configurable (threshold, window, notification channel)
- Alerts fire when conditions met (e.g., error rate > 5% for 5 minutes)
- Notifications sent via LOOP_ALERT_WEBHOOK_URL
- Alert deduplication (don't spam same alert)
- Alert resolution notification when condition clears

**Dependencies:** SEC-006, CONN-007

**Execution Type:** AI-Agent

**Priority:** Low

**Effort:** M

---

## 4. Dependency Graph

### 4.1 Blocking Dependencies (Critical Path)

```
INFRA-001 → INFRA-002 → [all packages]
INFRA-001 → INFRA-005 → CORE-001 → CORE-003 → CORE-004 → CORE-005
CORE-001 → CORE-006 → ENGINE-003 → ENGINE-006
CORE-001 → TRIG-001 → TRIG-002/003/004/005
CONN-001 → CONN-002/003/004/005/007
FE-001 → FE-002 → FE-003/004
SEC-001 → SEC-002
```

### 4.2 Parallelizable Groups

**Group A (can run simultaneously after INFRA-001):**
- INFRA-002, INFRA-003, INFRA-005, INFRA-006, INFRA-007
- CONN-008 (Semantic Types)
- ENGINE-001 (Topological Sort)

**Group B (can run simultaneously after CORE-001):**
- CORE-002 (PostgreSQL adapter)
- CORE-003 (Auth)
- CORE-006 (Workflow Authoring)
- CONN-001 (Connector Registry)
- TRIG-001 (Trigger Dispatcher)
- SEC-005 (Audit Logging)

**Group C (can run simultaneously after CONN-001):**
- CONN-002, CONN-003, CONN-004, CONN-005, CONN-007

**Group D (can run simultaneously after FE-001):**
- FE-002, FE-005, FE-006

**Group E (can run simultaneously after FE-002):**
- FE-003, FE-007

### 4.3 No Circular Dependencies

Verified: All dependencies flow strictly from infrastructure → core → business logic → API → frontend. No backward references.

---

## 5. Execution Phases

### Phase 1: Environment & Project Setup (Week 1)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | INFRA-001 | Monorepo Scaffolding | — |
| 2 | INFRA-002 | TypeScript Configuration | A |
| 2 | INFRA-003 | Docker & Compose | A |
| 2 | INFRA-005 | Database Migration Framework | A |
| 2 | INFRA-006 | Environment Configuration | A |
| 2 | INFRA-007 | Logging Infrastructure | A |
| 3 | INFRA-004 | CI/CD Pipeline | After INFRA-001 + INFRA-003 |

**Phase Gate:** `pnpm install && pnpm typecheck && pnpm test` all pass. Docker compose starts.

### Phase 2: Core Infrastructure (Weeks 2-3)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | CORE-001 | State Store (SQLite) | — |
| 2 | CORE-002 | PostgreSQL Adapter | B |
| 2 | CORE-003 | Authentication Service | B |
| 2 | CONN-008 | Semantic Type System | B |
| 2 | ENGINE-001 | Topological Sort & DAG | B |
| 2 | CONN-001 | Connector Interface & Registry | B |
| 3 | CORE-004 | RBAC Middleware | After CORE-003 |
| 3 | CORE-005 | API Gateway Skeleton | After CORE-003 + CORE-004 |
| 3 | CORE-007 | WebSocket Server | After CORE-005 |
| 3 | CORE-006 | Workflow Authoring Service | After CORE-001 |

**Phase Gate:** API server starts, authenticates users, CRUD workflows via REST.

### Phase 3: Core Business Logic (Weeks 4-6)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | ENGINE-002 | Execution State Machine | — |
| 1 | ENGINE-004 | Retry Logic | — |
| 1 | ENGINE-005 | Circuit Breaker | — |
| 2 | ENGINE-003 | Main Execution Executor | After ENGINE-001 + ENGINE-002 |
| 2 | TRIG-001 | Trigger Dispatcher | After CORE-001 + ENGINE-002 |
| 2 | CONN-002 | Vault Connector | C |
| 2 | CONN-003 | Desk Connector | C |
| 2 | CONN-004 | Recap Connector | C |
| 2 | CONN-005 | Generic Connector | C |
| 2 | CONN-006 | LLM Provider Layer | — |
| 2 | CONN-007 | Notification Connectors | C |
| 3 | ENGINE-006 | Control Flow Node Handlers | After ENGINE-003 |
| 3 | TRIG-002 | Cron Trigger | After TRIG-001 |
| 3 | TRIG-003 | Webhook Trigger | After TRIG-001 + CORE-005 |
| 3 | TRIG-004 | Event Trigger | After TRIG-001 + CONN-001 |
| 3 | TRIG-005 | Manual Trigger | After TRIG-001 + CORE-005 |
| 3 | ENGINE-007 | Execution Recovery | After ENGINE-003 + CORE-001 |

**Phase Gate:** Can create workflow, trigger execution, nodes execute in order, connectors called.

### Phase 4: API Layer (Weeks 5-6)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | API routes integrated from CORE-005, CORE-006, TRIG-*, CONN-* | — |
| All endpoints from TSD §5 implemented and tested | — |

**Phase Gate:** All API endpoints from TSD §5 return correct responses. OpenAPI spec generated.

### Phase 5: Frontend Canvas (Weeks 5-7)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | FE-001 | React Application Shell | — |
| 2 | FE-002 | Canvas Editor | After FE-001 |
| 2 | FE-005 | Metrics Dashboard | D |
| 2 | FE-006 | Admin Panel | D |
| 3 | FE-003 | Node Library & Config Panel | After FE-002 |
| 3 | FE-004 | Execution Monitor | After FE-001 + CORE-007 |
| 4 | FE-007 | Templates & Import/Export | After FE-002 |

**Phase Gate:** Full workflow lifecycle via UI: create → edit → execute → monitor.

### Phase 6: Security & Observability (Weeks 6-7)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | SEC-001 | Encryption Module | — |
| 1 | SEC-005 | Audit Logging | — |
| 2 | SEC-002 | Secrets Manager | After SEC-001 |
| 2 | SEC-003 | Egress Policy Engine | — |
| 2 | SEC-006 | Prometheus Metrics | — |
| 3 | SEC-004 | Code Node Sandbox | After SEC-003 |
| 3 | SEC-007 | OpenTelemetry Tracing | After SEC-006 |
| 3 | SEC-008 | Alerting System | After SEC-006 + CONN-007 |

**Phase Gate:** Encryption verified, egress policies enforced, metrics exported, sandbox isolates code.

### Phase 7: Testing & Deployment (Weeks 8-9)

| Order | Task ID | Title | Parallel Group |
|-------|---------|-------|----------------|
| 1 | All unit tests (≥80% coverage) | — |
| 2 | Integration tests | — |
| 3 | E2E tests (TSD §14.3 scenarios) | — |
| 4 | Docker image finalization | — |
| 5 | Helm chart (Scale tier) | — |
| 6 | Documentation | — |

**Phase Gate:** All tests pass, Docker images build, deployment succeeds on clean machine.

---

## 6. AI-Agent Optimization Layer

### 6.1 Task Suitability Matrix

| Task ID | Mode | Context Window | Risk | Notes |
|---------|------|----------------|------|-------|
| INFRA-001 | Single-shot | Minimal | Low | Boilerplate generation |
| INFRA-002 | Single-shot | Minimal | Low | Config files |
| INFRA-003 | Single-shot | Minimal | Low | Dockerfile templates |
| INFRA-004 | Single-shot | Minimal | Low | YAML config |
| INFRA-005 | Iterative | Medium | Medium | Complex schema, many entities |
| INFRA-006 | Single-shot | Medium | Low | Env var definitions |
| INFRA-007 | Single-shot | Minimal | Low | Logger setup |
| CORE-001 | Iterative | Medium | Medium | Many CRUD operations |
| CORE-002 | Iterative | Medium | Medium | Mirrors CORE-001 for PG |
| CORE-003 | Iterative | Medium | High | Security-critical, JWT flows |
| CORE-004 | Single-shot | Minimal | Low | Permission matrix |
| CORE-005 | Iterative | Medium | Medium | Middleware chain |
| CORE-006 | Iterative | Large | High | Validation + git integration |
| CORE-007 | Iterative | Medium | Medium | WebSocket lifecycle |
| ENGINE-001 | Single-shot | Minimal | Low | Algorithm implementation |
| ENGINE-002 | Iterative | Minimal | Medium | State transitions |
| ENGINE-003 | Iterative | Large | High | Core execution logic |
| ENGINE-004 | Single-shot | Minimal | Low | Retry algorithm |
| ENGINE-005 | Iterative | Minimal | Medium | State machine |
| ENGINE-006 | Iterative | Medium | High | Complex control flow |
| ENGINE-007 | Iterative | Medium | Medium | Recovery edge cases |
| CONN-001 | Iterative | Medium | Medium | Interface design |
| CONN-002-004 | Iterative | Medium | Medium | API integration |
| CONN-005 | Single-shot | Minimal | Low | Generic adapter |
| CONN-006 | Iterative | Large | High | 7 providers, fallback logic |
| CONN-007 | Iterative | Medium | Medium | Multiple channels |
| CONN-008 | Iterative | Medium | Medium | Type system design |
| TRIG-001 | Iterative | Medium | Medium | Event matching |
| TRIG-002 | Single-shot | Minimal | Low | Cron parsing |
| TRIG-003 | Iterative | Minimal | High | Security (HMAC, replay) |
| TRIG-004 | Iterative | Medium | Medium | Event subscription |
| TRIG-005 | Single-shot | Minimal | Low | Simple trigger |
| FE-001 | Iterative | Medium | Low | React boilerplate |
| FE-002 | Iterative | Large | High | Complex canvas interaction |
| FE-003 | Iterative | Medium | Medium | Dynamic forms |
| FE-004 | Iterative | Medium | Medium | Real-time updates |
| FE-005 | Iterative | Medium | Low | Chart components |
| FE-006 | Iterative | Large | Medium | Many admin sub-features |
| FE-007 | Single-shot | Minimal | Low | Import/export |
| SEC-001 | Iterative | Minimal | High | Crypto implementation |
| SEC-002 | Iterative | Medium | High | Security-critical |
| SEC-003 | Iterative | Medium | High | Network security |
| SEC-004 | Iterative | Large | High | Sandboxing (developer task) |
| SEC-005 | Single-shot | Minimal | Low | Append-only writes |
| SEC-006 | Iterative | Medium | Low | Metric definitions |
| SEC-007 | Iterative | Medium | Medium | OTel integration |
| SEC-008 | Iterative | Medium | Medium | Alert rules |

### 6.2 Agent Execution Guidelines

- **Single-shot tasks:** Provide full TSD section as context, generate complete file in one pass
- **Iterative tasks:** Generate skeleton first, then fill implementations incrementally with test verification between steps
- **High-risk tasks:** Require test-first approach — write tests, then implementation, verify with test run
- **Large context tasks:** Break into sub-files, each verified independently before integration

---

## 7. File-Level Mapping

### 7.1 Infrastructure Files

| File | Task | Type |
|------|------|------|
| `package.json` (root) | INFRA-001 | JSON |
| `pnpm-workspace.yaml` | INFRA-001 | YAML |
| `tsconfig.base.json` | INFRA-001 | JSON |
| `.eslintrc.js` | INFRA-001 | JS |
| `.prettierrc` | INFRA-001 | JSON |
| `vitest.config.ts` | INFRA-001 | TS |
| `apps/*/tsconfig.json` | INFRA-002 | JSON |
| `packages/*/tsconfig.json` | INFRA-002 | JSON |
| `docker/Dockerfile.app` | INFRA-003 | Dockerfile |
| `docker/Dockerfile.sandbox` | INFRA-003 | Dockerfile |
| `docker/Dockerfile.controlplane` | INFRA-003 | Dockerfile |
| `docker-compose.yml` | INFRA-003 | YAML |
| `docker-compose.dev.yml` | INFRA-003 | YAML |
| `.github/workflows/ci.yml` | INFRA-004 | YAML |
| `.github/workflows/release.yml` | INFRA-004 | YAML |
| `packages/state/src/migrations/001_initial_schema.ts` | INFRA-005 | TS |
| `packages/state/src/migrate.ts` | INFRA-005 | TS |
| `drizzle.config.ts` | INFRA-005 | TS |
| `apps/api/src/config.ts` | INFRA-006 | TS |
| `apps/sandbox/src/config.ts` | INFRA-006 | TS |
| `.env.example` | INFRA-006 | ENV |
| `packages/observability/src/logger.ts` | INFRA-007 | TS |
| `packages/observability/src/correlation.ts` | INFRA-007 | TS |

### 7.2 Core Backend Files

| File | Task | Type |
|------|------|------|
| `packages/state/src/interface.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/index.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/connection.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/workflows.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/executions.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/triggers.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/users.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/secrets.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/egress.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/connectors.ts` | CORE-001 | TS |
| `packages/state/src/sqlite/audit.ts` | CORE-001 | TS |
| `packages/state/src/postgres/index.ts` | CORE-002 | TS |
| `packages/state/src/postgres/connection.ts` | CORE-002 | TS |
| `packages/auth/src/jwt.ts` | CORE-003 | TS |
| `packages/auth/src/apikey.ts` | CORE-003 | TS |
| `packages/auth/src/password.ts` | CORE-003 | TS |
| `packages/auth/src/middleware.ts` | CORE-003 | TS |
| `apps/api/src/routes/auth.ts` | CORE-003 | TS |
| `apps/api/src/middleware/rbac.ts` | CORE-004 | TS |
| `packages/auth/src/permissions.ts` | CORE-004 | TS |
| `apps/api/src/server.ts` | CORE-005 | TS |
| `apps/api/src/middleware/errorHandler.ts` | CORE-005 | TS |
| `apps/api/src/middleware/rateLimit.ts` | CORE-005 | TS |
| `apps/api/src/middleware/cors.ts` | CORE-005 | TS |
| `apps/api/src/middleware/requestId.ts` | CORE-005 | TS |
| `packages/workflow-authoring/src/service.ts` | CORE-006 | TS |
| `packages/workflow-authoring/src/validator.ts` | CORE-006 | TS |
| `packages/workflow-authoring/src/topology.ts` | CORE-006 | TS |
| `packages/versioning/src/service.ts` | CORE-006 | TS |
| `packages/versioning/src/git.ts` | CORE-006 | TS |
| `packages/versioning/src/diff.ts` | CORE-006 | TS |
| `apps/api/src/websocket/executionStream.ts` | CORE-007 | TS |

### 7.3 Engine Files

| File | Task | Type |
|------|------|------|
| `packages/engine/src/scheduler.ts` | ENGINE-001 | TS |
| `packages/engine/src/dag.ts` | ENGINE-001 | TS |
| `packages/engine/src/types.ts` | ENGINE-001 | TS |
| `packages/engine/src/stateMachine.ts` | ENGINE-002 | TS |
| `packages/engine/src/executor.ts` | ENGINE-003 | TS |
| `packages/engine/src/retry.ts` | ENGINE-004 | TS |
| `packages/engine/src/circuitBreaker.ts` | ENGINE-005 | TS |
| `packages/engine/src/nodes/branch.ts` | ENGINE-006 | TS |
| `packages/engine/src/nodes/loop.ts` | ENGINE-006 | TS |
| `packages/engine/src/nodes/parallel.ts` | ENGINE-006 | TS |
| `packages/engine/src/nodes/approval.ts` | ENGINE-006 | TS |
| `packages/engine/src/nodes/delay.ts` | ENGINE-006 | TS |
| `packages/engine/src/recovery.ts` | ENGINE-007 | TS |

### 7.4 Connector Files

| File | Task | Type |
|------|------|------|
| `packages/connectors/src/interface.ts` | CONN-001 | TS |
| `packages/connectors/src/registry.ts` | CONN-001 | TS |
| `packages/connectors/src/types.ts` | CONN-001 | TS |
| `packages/connectors/src/vault/adapter.ts` | CONN-002 | TS |
| `packages/connectors/src/vault/types.ts` | CONN-002 | TS |
| `packages/connectors/src/vault/operations.ts` | CONN-002 | TS |
| `packages/connectors/src/desk/adapter.ts` | CONN-003 | TS |
| `packages/connectors/src/desk/types.ts` | CONN-003 | TS |
| `packages/connectors/src/desk/operations.ts` | CONN-003 | TS |
| `packages/connectors/src/recap/adapter.ts` | CONN-004 | TS |
| `packages/connectors/src/recap/types.ts` | CONN-004 | TS |
| `packages/connectors/src/recap/operations.ts` | CONN-004 | TS |
| `packages/connectors/src/generic/adapter.ts` | CONN-005 | TS |
| `packages/connectors/src/generic/config.ts` | CONN-005 | TS |
| `packages/llm/src/interface.ts` | CONN-006 | TS |
| `packages/llm/src/ollama.ts` | CONN-006 | TS |
| `packages/llm/src/vllm.ts` | CONN-006 | TS |
| `packages/llm/src/openai.ts` | CONN-006 | TS |
| `packages/llm/src/anthropic.ts` | CONN-006 | TS |
| `packages/llm/src/azure.ts` | CONN-006 | TS |
| `packages/llm/src/bedrock.ts` | CONN-006 | TS |
| `packages/llm/src/vertex.ts` | CONN-006 | TS |
| `packages/llm/src/router.ts` | CONN-006 | TS |
| `packages/connectors/src/notification/slack.ts` | CONN-007 | TS |
| `packages/connectors/src/notification/email.ts` | CONN-007 | TS |
| `packages/connectors/src/notification/webhook.ts` | CONN-007 | TS |
| `packages/connectors/src/notification/queue.ts` | CONN-007 | TS |
| `packages/types/src/registry.ts` | CONN-008 | TS |
| `packages/types/src/schemas/document.ts` | CONN-008 | TS |
| `packages/types/src/schemas/transcript.ts` | CONN-008 | TS |
| `packages/types/src/schemas/actionItem.ts` | CONN-008 | TS |
| `packages/types/src/schemas/task.ts` | CONN-008 | TS |
| `packages/types/src/schemas/calendarEvent.ts` | CONN-008 | TS |
| `packages/types/src/validator.ts` | CONN-008 | TS |
| `packages/types/src/coercion.ts` | CONN-008 | TS |

### 7.5 Trigger Files

| File | Task | Type |
|------|------|------|
| `packages/triggers/src/dispatcher.ts` | TRIG-001 | TS |
| `packages/triggers/src/cron.ts` | TRIG-002 | TS |
| `packages/triggers/src/webhook.ts` | TRIG-003 | TS |
| `apps/api/src/routes/webhooks.ts` | TRIG-003 | TS |
| `packages/triggers/src/event.ts` | TRIG-004 | TS |
| `packages/triggers/src/manual.ts` | TRIG-005 | TS |

### 7.6 Frontend Files

| File | Task | Type |
|------|------|------|
| `apps/canvas/src/main.tsx` | FE-001 | TSX |
| `apps/canvas/src/App.tsx` | FE-001 | TSX |
| `apps/canvas/vite.config.ts` | FE-001 | TS |
| `apps/canvas/tailwind.config.ts` | FE-001 | TS |
| `apps/canvas/src/api/client.ts` | FE-001 | TS |
| `apps/canvas/src/stores/authStore.ts` | FE-001 | TS |
| `apps/canvas/src/components/canvas/CanvasEditor.tsx` | FE-002 | TSX |
| `apps/canvas/src/components/canvas/nodes/*.tsx` | FE-002 | TSX |
| `apps/canvas/src/components/canvas/edges/*.tsx` | FE-002 | TSX |
| `apps/canvas/src/stores/workflowStore.ts` | FE-002 | TS |
| `apps/canvas/src/components/canvas/NodeLibrary.tsx` | FE-003 | TSX |
| `apps/canvas/src/components/canvas/NodeConfigPanel.tsx` | FE-003 | TSX |
| `apps/canvas/src/components/executions/ExecutionMonitor.tsx` | FE-004 | TSX |
| `apps/canvas/src/components/executions/ExecutionList.tsx` | FE-004 | TSX |
| `apps/canvas/src/components/executions/ExecutionDetail.tsx` | FE-004 | TSX |
| `apps/canvas/src/stores/executionStore.ts` | FE-004 | TS |
| `apps/canvas/src/components/dashboard/MetricsDashboard.tsx` | FE-005 | TSX |
| `apps/canvas/src/components/dashboard/ExecutionCharts.tsx` | FE-005 | TSX |
| `apps/canvas/src/components/admin/AdminPanel.tsx` | FE-006 | TSX |
| `apps/canvas/src/components/admin/UserManagement.tsx` | FE-006 | TSX |
| `apps/canvas/src/components/admin/SecretsManager.tsx` | FE-006 | TSX |
| `apps/canvas/src/components/admin/EgressPolicies.tsx` | FE-006 | TSX |
| `apps/canvas/src/components/admin/DataFlowMap.tsx` | FE-006 | TSX |
| `apps/canvas/src/components/templates/TemplateGallery.tsx` | FE-007 | TSX |

### 7.7 Security & Observability Files

| File | Task | Type |
|------|------|------|
| `packages/secrets/src/encryption.ts` | SEC-001 | TS |
| `packages/secrets/src/manager.ts` | SEC-002 | TS |
| `packages/secrets/src/vault.ts` | SEC-002 | TS |
| `packages/egress/src/engine.ts` | SEC-003 | TS |
| `packages/egress/src/resolver.ts` | SEC-003 | TS |
| `packages/egress/src/interceptor.ts` | SEC-003 | TS |
| `apps/sandbox/src/server.ts` | SEC-004 | TS |
| `apps/sandbox/src/executor.ts` | SEC-004 | TS |
| `apps/sandbox/src/network.ts` | SEC-004 | TS |
| `apps/sandbox/src/resources.ts` | SEC-004 | TS |
| `packages/audit/src/service.ts` | SEC-005 | TS |
| `packages/observability/src/metrics.ts` | SEC-006 | TS |
| `apps/api/src/routes/system.ts` | SEC-006 | TS |
| `packages/observability/src/tracing.ts` | SEC-007 | TS |
| `packages/observability/src/alerting.ts` | SEC-008 | TS |

### 7.8 File Ownership Conflicts: NONE

Each file is owned by exactly one task. Shared packages are built incrementally (interface first, then implementations).

---

## 8. Test Task Mapping

### 8.1 Unit Tests

| Source Task | Test File | Test Focus |
|-------------|-----------|------------|
| INFRA-005 | `tests/unit/state/migrations.test.ts` | Migration apply/rollback |
| CORE-001 | `tests/unit/state/sqlite/*.test.ts` | All CRUD operations per entity |
| CORE-002 | `tests/unit/state/postgres/*.test.ts` | PostgreSQL CRUD (same tests as SQLite) |
| CORE-003 | `tests/unit/auth/jwt.test.ts` | Token generation, validation, expiry |
| CORE-003 | `tests/unit/auth/apikey.test.ts` | API key generation, hashing |
| CORE-004 | `tests/unit/auth/rbac.test.ts` | Permission checks per role |
| CORE-006 | `tests/unit/workflow-authoring/validator.test.ts` | All 6 validation rules |
| CORE-006 | `tests/unit/versioning/git.test.ts` | Git operations |
| ENGINE-001 | `tests/unit/engine/scheduler.test.ts` | Topological sort, cycle detection |
| ENGINE-002 | `tests/unit/engine/stateMachine.test.ts` | All state transitions |
| ENGINE-003 | `tests/unit/engine/executor.test.ts` | Execution flow, variable interpolation |
| ENGINE-004 | `tests/unit/engine/retry.test.ts` | Backoff calculations, retry counts |
| ENGINE-005 | `tests/unit/engine/circuitBreaker.test.ts` | State transitions, thresholds |
| ENGINE-006 | `tests/unit/engine/nodes/*.test.ts` | Each control node type |
| CONN-001 | `tests/unit/connectors/registry.test.ts` | Registration, lookup, health |
| CONN-006 | `tests/unit/llm/router.test.ts` | Fallback chain, provider selection |
| CONN-008 | `tests/unit/types/validator.test.ts` | Type validation, coercion |
| TRIG-001 | `tests/unit/triggers/dispatcher.test.ts` | Event matching |
| TRIG-002 | `tests/unit/triggers/cron.test.ts` | Cron parsing, timezone |
| TRIG-003 | `tests/unit/triggers/webhook.test.ts` | HMAC verification, replay protection |
| SEC-001 | `tests/unit/secrets/encryption.test.ts` | Encrypt/decrypt round-trip |
| SEC-003 | `tests/unit/egress/engine.test.ts` | Policy evaluation, domain/IP/region matching |

### 8.2 Integration Tests

| Test Suite | Tasks Covered | Description |
|------------|---------------|-------------|
| `tests/integration/api/workflows.test.ts` | CORE-005, CORE-006 | Full workflow CRUD via HTTP |
| `tests/integration/api/executions.test.ts` | CORE-005, ENGINE-003 | Execute workflow, check results |
| `tests/integration/api/auth.test.ts` | CORE-003, CORE-004 | Login, token refresh, RBAC |
| `tests/integration/engine/e2e-execution.test.ts` | ENGINE-001 through ENGINE-006 | Full workflow execution with mock connectors |
| `tests/integration/triggers/trigger-to-execution.test.ts` | TRIG-001 through TRIG-005 | Trigger fires → execution completes |
| `tests/integration/connectors/vault.test.ts` | CONN-002 | Vault operations against mock server |
| `tests/integration/connectors/desk.test.ts` | CONN-003 | Desk operations against mock server |
| `tests/integration/connectors/recap.test.ts` | CONN-004 | Recap operations against mock server |
| `tests/integration/sandbox/execution.test.ts` | SEC-004 | Code execution with resource limits |
| `tests/integration/state/migration.test.ts` | INFRA-005 | Migration on SQLite + PostgreSQL |
| `tests/integration/security/egress.test.ts` | SEC-003 | Egress policy enforcement |
| `tests/integration/security/encryption.test.ts` | SEC-001, SEC-002 | Encrypted storage round-trip |

### 8.3 End-to-End Tests

| Scenario | TSD Reference | Tasks Covered |
|----------|---------------|---------------|
| Meeting → Tasks → KB | TSD §14.3 | All epics |
| Air-gapped deployment | TSD §14.3 | SEC-003, CONN-006 |
| RBAC enforcement | TSD §14.3 | CORE-003, CORE-004 |
| Failover (Scale) | TSD §14.3 | ENGINE-007, CORE-002 |
| Code Node isolation | TSD §14.3 | SEC-004 |
| Egress policy | TSD §14.3 | SEC-003 |

### 8.4 Test Inputs & Expected Outputs (Key Examples)

**ENGINE-001 (Topological Sort):**
- Input: 5 nodes with edges forming a diamond DAG
- Expected: Correct topological order, parallel levels identified
- Input: 3 nodes with circular edge
- Expected: WorkflowValidationError thrown

**ENGINE-004 (Retry):**
- Input: Function that fails twice then succeeds, max_attempts=3, exponential backoff
- Expected: Succeeds on 3rd attempt, total delay = baseDelay + 2*baseDelay

**SEC-001 (Encryption):**
- Input: "sensitive data" with known key
- Expected: Decrypt(Encrypt(input)) === input, IV differs per call

**TRIG-003 (Webhook):**
- Input: POST with valid HMAC signature
- Expected: 200, execution created
- Input: POST with invalid signature
- Expected: 401

---

## 9. Definition of Done (Global)

### 9.1 Code Completion

- [ ] All tasks in this TBK implemented
- [ ] All files from §7 created with correct content
- [ ] No TypeScript compilation errors (`pnpm typecheck` passes)
- [ ] No ESLint violations (`pnpm lint` passes)
- [ ] All API endpoints from TSD §5 implemented and returning correct responses
- [ ] All data models match TSD §4 schemas exactly
- [ ] All environment variables from TSD §10 supported

### 9.2 Testing

- [ ] Unit test coverage ≥ 80% for all business logic modules
- [ ] All integration tests pass against SQLite and PostgreSQL
- [ ] All 6 E2E scenarios from TSD §14.3 pass
- [ ] No flaky tests (all tests deterministic)
- [ ] Test suite completes in < 5 minutes

### 9.3 Security

- [ ] Authentication flow works end-to-end (TSD §11.1)
- [ ] RBAC enforced on all endpoints (TSD §11.2)
- [ ] Execution I/O encrypted at rest (TSD §11.4)
- [ ] Secrets encrypted at rest
- [ ] Egress policies enforced (default deny)
- [ ] Webhook signatures verified (HMAC-SHA256)
- [ ] No SQL injection vectors (parameterized queries only)
- [ ] No hardcoded secrets in source code
- [ ] Input validation on all API boundaries (Zod schemas)

### 9.4 Deployment

- [ ] Docker images build successfully (app, sandbox, control-plane)
- [ ] `docker compose up` starts complete Core tier
- [ ] Application starts within 10 seconds (cold start)
- [ ] Health check endpoint responds correctly
- [ ] Database migrations run automatically on startup
- [ ] Air-gapped mode verified (zero outbound connections)

### 9.5 Observability

- [ ] All 15 Prometheus metrics collected and exported
- [ ] Structured JSON logging on all operations
- [ ] Correlation IDs propagated (request_id, execution_id)
- [ ] Health/readiness probes functional
- [ ] Audit log captures all state-changing operations

### 9.6 Documentation

- [ ] API reference generated from schemas
- [ ] Deployment guide complete
- [ ] Node reference (all node types documented)
- [ ] README with quickstart guide

### 9.7 No Unresolved Dependencies

- [ ] All task dependencies satisfied
- [ ] No circular dependencies
- [ ] All external integrations have fallback behavior
- [ ] All error paths handled

---

## 10. Risk & Bottleneck Identification

### 10.1 High-Complexity Tasks

| Task | Risk | Impact | Mitigation |
|------|------|--------|------------|
| ENGINE-003 (Main Executor) | High | Blocks all execution | Build incrementally: linear first, then branching, then parallel |
| ENGINE-006 (Control Flow Nodes) | High | Complex state management | Implement one node type at a time, test each independently |
| CORE-006 (Workflow Authoring) | High | Validation logic complex | Start with basic CRUD, add validation rules incrementally |
| CONN-006 (LLM Providers) | High | 7 providers, each different | Implement interface + router first, add providers one by one |
| SEC-004 (Sandbox) | High | Requires OS-level isolation | PoC in Week 1 (TSD U1); Firecracker fallback if gVisor fails |
| FE-002 (Canvas Editor) | High | Complex React Flow integration | Start with static rendering, add interactivity incrementally |

### 10.2 External System Dependencies

| Dependency | Risk | Mitigation |
|------------|------|------------|
| ODW Agent APIs (Vault/Desk/Recap) | APIs may change or be unavailable | Mock servers for development; interface abstraction for swap |
| gVisor/Firecracker | Cold start performance unknown | PoC benchmark in Month 1 (TSD U1); pre-warmed pool |
| LLM Providers | Rate limits, latency variability | Circuit breaker + fallback chain; local LLM default |
| isomorphic-git | Platform compatibility | Test on all target platforms early; alternative VFS ready |

### 10.3 Performance Bottlenecks

| Bottleneck | Task | Mitigation |
|------------|------|------------|
| SQLite write contention | CORE-001 | WAL mode; hard cap 50 concurrent; upgrade path to PostgreSQL |
| LLM inference latency | CONN-006 | Prompt caching; batch inference; async node execution |
| Code Node cold start | SEC-004 | Pre-warmed sandbox pool (LOOP_SANDBOX_POOL_SIZE) |
| Topological sort on large DAGs | ENGINE-001 | O(V+E) algorithm; cache sorted order until workflow changes |
| Execution history growth | Background jobs | Configurable retention; automatic pruning job |

### 10.4 Suggested Mitigations

1. **Mocking Strategy:** All external dependencies (ODW agents, LLM providers, databases) have mock implementations for development and testing (TSD §14.4)
2. **Parallel Scaffolding:** Generate all file skeletons in Phase 1, then fill implementations in parallel
3. **Incremental Delivery:** Each epic delivers a vertically-sliced capability that can be demoed independently
4. **Feature Flags:** Use LOOP_ENV to gate Scale-tier features; Core tier always works
5. **Contract Testing:** Define interface contracts early; test against contracts before implementations complete

---

## 11. Output Requirements

### 11.1 Deliverable Checklist

| # | Deliverable | Format | Verification |
|---|-------------|--------|--------------|
| 1 | Complete monorepo with all packages | TypeScript source | `pnpm typecheck` passes |
| 2 | Working API server | Fastify application | All TSD §5 endpoints respond correctly |
| 3 | Working execution engine | @loop/engine package | Can execute 3-node workflow end-to-end |
| 4 | All connectors implemented | @loop/connectors + @loop/llm | Health checks pass against mock servers |
| 5 | All triggers functional | @loop/triggers | Cron fires, webhook accepted, events matched |
| 6 | Working frontend | React SPA | Full workflow lifecycle via UI |
| 7 | Security enforced | Encryption + egress + RBAC | Penetration test scenarios pass |
| 8 | Observability complete | Metrics + logs + traces | Grafana dashboards populated |
| 9 | Docker deployment | Docker Compose | `docker compose up` → working system |
| 10 | Test suite | Vitest | ≥80% coverage, all tests pass |
| 11 | Documentation | Markdown | API ref, deployment guide, node reference |
| 12 | CI/CD pipeline | GitHub Actions | PR checks + release automation |

### 11.2 Quality Gates

Each phase must pass its gate before proceeding:

- **Phase 1 Gate:** `pnpm install && pnpm typecheck && docker compose build` all succeed
- **Phase 2 Gate:** API server authenticates, CRUD workflows via curl
- **Phase 3 Gate:** Execute a 3-node workflow via API, see results in DB
- **Phase 4 Gate:** All API endpoints return correct responses (automated test)
- **Phase 5 Gate:** Create → edit → execute → monitor workflow via UI
- **Phase 6 Gate:** Encrypted data verified, egress blocked, metrics exported
- **Phase 7 Gate:** Full test suite passes, Docker deployment works on clean machine

### 11.3 Naming & Structure Compliance

All outputs must comply with TSD §18:
- TypeScript files: camelCase
- React components: PascalCase
- Directories: kebab-case
- Database tables: snake_case plural
- API paths: kebab-case plural nouns
- Environment variables: UPPER_SNAKE_CASE with LOOP_ prefix
- Error codes: UPPER_SNAKE_CASE with category prefix

### 11.4 Performance Requirements

All outputs must meet TSD §13.4 targets:
- Trigger → first node: ≤ 500ms (p95)
- Engine overhead per node: ≤ 50ms (p95)
- Canvas interaction: ≤ 100ms (p95)
- History query (1000 rows): ≤ 2s (p95)
- API CRUD response: ≤ 200ms (p95)
- Cold start: ≤ 10s

---

## 12. Reference Implementation Guide (Added 2026-06-24)

This section maps each task to specific reference code from cloned repositories that should be consulted during implementation. Reference repos are in the `reference/` directory.

### 12.1 Quick Reference: Which Repo for Which Task

| Epic | Primary Reference | Secondary Reference | Key Files to Study |
|------|-------------------|---------------------|-------------------|
| INFRA (Epic 1) | Activepieces | Trigger.dev, n8n | `pnpm-workspace.yaml`, `package.json`, Dockerfiles |
| CORE (Epic 2) | Activepieces, n8n | Trigger.dev | State store, auth, credential management |
| ENGINE (Epic 3) | n8n, Trigger.dev | Activepieces | `workflow-execute.ts`, run-engine subsystems |
| CONN (Epic 4) | n8n, Activepieces | Flowise | Node interfaces, piece SDK, LLM nodes |
| TRIG (Epic 5) | n8n | Activepieces, Inngest | Webhook handling, cron, event triggers |
| FE (Epic 6) | Activepieces, Flowise | n8n | React Flow canvas, execution monitor |
| SEC (Epic 7) | n8n, Trigger.dev | E2B (not cloned) | Encryption, sandbox, audit logging |

### 12.2 Per-Task Reference Details

#### Epic 1: INFRA

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| INFRA-001 | Activepieces | `pnpm-workspace.yaml`, `package.json` | Monorepo workspace layout with core/* packages |
| INFRA-001 | n8n | `package.json` | Turbo + pnpm build orchestration, `agent:setup` pattern |
| INFRA-002 | Trigger.dev | `tsconfig.base.json` | Strict TypeScript config with project references |
| INFRA-003 | Activepieces | `docker-compose.yml` | Multi-service Docker Compose for workflow engine |
| INFRA-005 | Activepieces | `packages/server/api/src/app/database/` | Database abstraction with TypeORM (adapt to Drizzle) |

#### Epic 2: CORE

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| CORE-001 | Activepieces | `packages/server/api/src/app/database/` | Repository pattern, SQLite adapter |
| CORE-003 | n8n | `packages/cli/src/controllers/auth.controller.ts` | JWT auth flow, login/refresh |
| CORE-003 | Activepieces | `packages/server/api/src/app/authentication/` | Auth module structure |
| CORE-004 | n8n | `packages/@n8n/permissions/` | RBAC permission definitions |
| CORE-005 | Activepieces | `packages/server/api/src/app/` | Fastify server setup with middleware chain |
| CORE-006 | n8n | `packages/workflow/src/workflow.ts` | Pure Workflow graph model (no execution state) |
| CORE-006 | n8n | `packages/workflow/src/workflow-validation.ts` | Topology validation rules |
| CORE-007 | n8n | `packages/frontend/editor-ui/src/` | WebSocket/SSE push connection for execution updates |

#### Epic 3: ENGINE

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| ENGINE-001 | n8n | `packages/core/src/execution-engine/workflow-execute.ts` | Worklist/stack interpreter + `waitingExecution` join map |
| ENGINE-001 | Trigger.dev | `internal-packages/run-engine/src/engine/` | Modular subsystem composition pattern |
| ENGINE-002 | Trigger.dev | `internal-packages/run-engine/src/engine/` | Execution snapshot chain, state transitions |
| ENGINE-003 | n8n | `packages/core/src/execution-engine/workflow-execute.ts` | Main execution loop, variable interpolation via `WorkflowDataProxy` |
| ENGINE-003 | Activepieces | `packages/core/execution/src/lib/flow-run/execution/` | Flow execution with step-by-step output capture |
| ENGINE-004 | Trigger.dev | `packages/core/src/retry.ts` | Error classification (always-retry vs never-retry) |
| ENGINE-004 | n8n | `packages/core/src/execution-engine/workflow-execute.ts` | Simple retry loop (count + delay, clamped) |
| ENGINE-005 | n8n | `packages/core/src/` | Circuit breaker for external service calls |
| ENGINE-006 | n8n | `packages/nodes-base/nodes/` | If/Switch/Merge/Loop node implementations |
| ENGINE-006 | Activepieces | `packages/core/execution/src/lib/flows/` | Branch and loop handling in flow execution |
| ENGINE-007 | Trigger.dev | `internal-packages/run-engine/src/engine/` | Execution recovery patterns |

#### Epic 4: CONN

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| CONN-001 | n8n | `packages/workflow/src/` | `INodeType`, `INodeTypeDescription`, `INodeExecutionData`, `NodeConnectionType` |
| CONN-001 | Activepieces | `packages/pieces/framework/` | Piece SDK: actions + triggers + auth per connector |
| CONN-002/003/004 | n8n | `packages/nodes-base/nodes/` | Example integration nodes (study 2-3 similar connectors) |
| CONN-002/003/004 | Activepieces | `packages/pieces/community/` | Example piece implementations |
| CONN-006 | Flowise | `packages/components/nodes/` | LLM node implementations for various providers |
| CONN-006 | Activepieces | `packages/pieces/community/` | AI/LLM piece implementations |
| CONN-008 | Activepieces | `packages/core/piece-types/src/lib/` | Type definitions for flow data (flows, engine, triggers) |

#### Epic 5: TRIG

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| TRIG-001 | n8n | `packages/core/src/execution-engine/active-workflow-triggers.ts` | Trigger matching and dispatch |
| TRIG-001 | Inngest | `packages/inngest/src/` | Event matching and step function dispatch |
| TRIG-002 | n8n | `packages/core/src/execution-engine/scheduled-task-manager.ts` | Cron scheduling with node-cron |
| TRIG-003 | n8n | `packages/cli/src/` | Webhook registration, lookup caching, dynamic paths, response modes |
| TRIG-003 | Activepieces | `packages/core/piece-types/src/lib/trigger.ts` | Trigger type definitions |
| TRIG-004 | n8n | `packages/core/src/execution-engine/triggers-and-pollers.ts` | Event trigger activation |
| TRIG-004 | Activepieces | `packages/core/execution/src/lib/flows/test-trigger.ts` | Trigger testing patterns |

#### Epic 6: FE

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| FE-001 | Activepieces | `packages/web/` | React SPA shell with Vite, routing, i18n, Zustand stores |
| FE-002 | Flowise | `packages/ui/src/` | React Flow implementation for visual workflow builder |
| FE-002 | Activepieces | `packages/web/src/` | React Flow canvas with custom nodes, `useCanvasMapping()` |
| FE-003 | Activepieces | `packages/web/src/` | Node palette and config panel components |
| FE-004 | n8n | `packages/frontend/editor-ui/src/` | Execution visualization, WebSocket/SSE push, per-node status |
| FE-005 | Activepieces | `packages/web/src/` | Dashboard and metrics components |
| FE-006 | Activepieces | `packages/web/src/` | Admin panel and settings UI |

#### Epic 7: SEC

| Task | Reference Repo | Specific Files | What to Learn |
|------|---------------|----------------|---------------|
| SEC-001 | n8n | `packages/core/src/encryption/aes-256-gcm.ts` | AES-256-GCM with HKDF key derivation, format versioning |
| SEC-001 | n8n | `packages/core/src/encryption/` | Full encryption module (cipher interface, key proxy, AES-256-CBC legacy) |
| SEC-002 | n8n | `packages/cli/src/credentials-helper.ts` | Full credential lifecycle: getDecrypted(), authenticate(), OAuth2 refresh |
| SEC-003 | n8n | `packages/core/src/credential-domain-restrictions.ts` | Domain restriction approach |
| SEC-004 | Trigger.dev | `internal-packages/compute/` | Firecracker VM gateway |
| SEC-004 | — | E2B (not cloned, reference online) | Firecracker sandbox lifecycle, pool management |
| SEC-005 | Activepieces | `packages/server/api/src/app/` | Audit logging patterns |
| SEC-006 | n8n | `packages/cli/src/` | Prometheus metrics export |

### 12.3 Security Advisories for Implementation

| Advisory | Severity | Implication |
|----------|----------|------------|
| n8n CVE-2025-68668 | 9.9 Critical | Pyodide WASM sandbox escape → full RCE. **Loop MUST use gVisor/Firecracker, not VM/WASM** |
| n8n CVE-2025-68613 | Critical | Node.js VM sandbox escape → full RCE. **VM-based sandboxing is insufficient** |
| vm2 CVE-2026-22709 | Critical | Sandbox escape → arbitrary code execution. **Do NOT use vm2 as sole isolation** |

### 12.4 Implementation Priority for Reference Study

Before implementing each epic, spend time studying these high-value files:

**Must-study before Epic 1 (INFRA):**
- `reference/activepieces/pnpm-workspace.yaml` — monorepo layout

**Must-study before Epic 3 (ENGINE):**
- `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts` — the execution engine
- `reference/trigger.dev/internal-packages/run-engine/src/engine/` — modular subsystems

**Must-study before Epic 4 (CONN):**
- `reference/n8n/packages/workflow/src/` — node interface contracts
- `reference/activepieces/packages/pieces/framework/` — piece SDK pattern

**Must-study before Epic 6 (FE):**
- `reference/Flowise/packages/ui/src/` — React Flow visual builder
- `reference/activepieces/packages/web/src/` — React Flow canvas with custom nodes

**Must-study before Epic 7 (SEC):**
- `reference/n8n/packages/core/src/encryption/aes-256-gcm.ts` — production-grade encryption
- `reference/n8n/packages/cli/src/credentials-helper.ts` — credential lifecycle

---

**End of Task Breakdown Document**

*This TBK decomposes the Loop TSD into 47 atomic tasks across 7 epics, organized into 7 execution phases. All tasks are dependency-mapped, file-assigned, and test-covered. The document is optimized for AI-agent execution with clear single-shot vs. iterative guidance per task. Reference implementations in `reference/` provide concrete code patterns for each task — consult the Reference Implementation Guide (Section 12) before starting each epic.*
