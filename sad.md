# Loop — System Architecture Document

**Product:** Loop (ODW.ai Suite)
**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-06-23
**Author:** Architecture Team, ODW.ai

---

## 1. Architecture Overview

### 1.1 Purpose

Loop is the orchestration layer of the ODW.ai sovereign agent suite. It connects ODW's individual agents — Vault (knowledge base), Desk (workspace/productivity), Recap (meeting intelligence), and future modules — into automated, multi-step workflows that execute entirely on the customer's own infrastructure. Loop is not a general-purpose workflow engine; it is the conductor of a sovereign agent suite, purpose-built to coordinate ODW's agents with full semantic awareness of their primitives while enforcing data sovereignty as a first-class architectural constraint.

### 1.2 Architectural Style

Loop employs a **hybrid event-driven + modular monolith** architecture with a clear separation between the control plane (workflow authoring, configuration, RBAC) and the execution plane (runtime engine, node dispatch, state transitions).

- **Control Plane:** Modular monolith — a single deployable unit containing the workflow builder API, versioning service, configuration service, and RBAC engine. Chosen over microservices to minimize deployment complexity for self-hosted SMB customers who lack platform engineering teams.
- **Execution Plane:** Event-driven, actor-based runtime — an in-process execution engine that processes workflow DAGs using a topological scheduler, with an internal event bus for trigger dispatch and inter-node communication. In Scale tier, this becomes a distributed actor system backed by a message queue.
- **Integration Layer:** Adapter-pattern connectors — each ODW agent module is accessed through a typed adapter that translates between Loop's semantic type system and the agent's native API.

### 1.3 Justification & Trade-offs

| Decision | Trade-off |
|----------|-----------|
| Modular monolith (Core) vs. microservices | Reduces operational complexity for self-hosted deployments; sacrifices independent service scaling. Acceptable because Core tier targets single-instance deployments where horizontal scaling is not required. Scale tier decomposes into microservices. |
| In-process execution (Core) vs. distributed queue | Eliminates external queue dependency (Redis/RabbitMQ) for Core tier; limits concurrent executions to single-node capacity (~50 concurrent). Scale tier introduces Redis-backed distributed execution for 200+ concurrent per node. |
| Event-driven triggers vs. polling | Lower latency (sub-second trigger-to-execution); requires ODW agents to expose event buses. Mitigated by adapter layer that can fall back to polling for agents without event support. |
| Git-backed versioning vs. internal VFS | Power-user friendly, enables CI/CD integration; adds git dependency. Abstracted behind UI for non-engineers; power users can access git directly. |
| SQLite (Core) vs. PostgreSQL (Scale) | Zero-config for Core tier; limits concurrency and multi-instance support. Clean migration path to PostgreSQL for Scale tier upgrades. |

---

## 2. High-Level System Components

### 2.1 Component Inventory

#### Loop Canvas (Frontend)
- **Responsibility:** Visual workflow builder (node-and-edge canvas), workflow configuration panels, execution monitoring dashboard, data flow visualization, admin settings UI.
- **Inputs:** Workflow definitions (JSON), execution state (WebSocket stream), configuration data.
- **Outputs:** User actions (node placement, edge creation, configuration changes), rendered workflow visualizations.
- **Technology:** React 18+, TypeScript, React Flow (canvas library), Zustand (state management), Tailwind CSS.

#### API Gateway
- **Responsibility:** Single entry point for all client requests. Handles authentication, rate limiting, request routing to internal services, and response serialization. Enforces RBAC policies on every request.
- **Inputs:** HTTP/WebSocket requests from Loop Canvas and external API consumers.
- **Outputs:** Routed requests to internal services; authenticated responses to clients.
- **Technology:** Express.js (Node.js) or Fastify; JWT validation middleware; rate limiter (token bucket).

#### Workflow Authoring Service
- **Responsibility:** CRUD operations on workflow definitions. Manages the node graph data structure, validates workflow topology (cycle detection, port compatibility), handles import/export, and coordinates with the Versioning Service on save.
- **Inputs:** Workflow definitions, node configurations, user actions.
- **Outputs:** Validated workflow definitions, version commits, topology validation results.
- **Technology:** TypeScript/Node.js service within the modular monolith.

#### Versioning Service
- **Responsibility:** Manages workflow version history. Auto-commits workflow definitions to a git repository on each save. Supports diff, rollback, and branch operations. Abstracts git behind a "versions" concept for non-engineers.
- **Inputs:** Workflow definitions (on save), version query requests.
- **Outputs:** Git commits, version history, diffs, restored workflow states.
- **Technology:** libgit2 (bundled) or system git; isomorphic-git for browser-based operations.

#### Execution Engine
- **Responsibility:** The core runtime that interprets workflow DAGs, dispatches nodes in topological order, manages execution state transitions, handles branching/looping/parallelism, enforces timeouts and retries, and captures I/O for each node execution.
- **Inputs:** Trigger events (cron, webhook, ODW agent events, manual), workflow definitions, node execution results.
- **Outputs:** Execution state transitions, node I/O records, completion/failure signals, audit events.
- **Technology:** TypeScript/Node.js (Core: in-process event loop; Scale: distributed actor model with Redis Streams or NATS).

#### Trigger Dispatcher
- **Responsibility:** Receives external events (cron ticks, webhook POSTs, ODW agent lifecycle events) and matches them against registered workflow triggers. Creates execution instances for matching workflows.
- **Inputs:** Cron schedule ticks, HTTP webhook requests, ODW agent event bus messages.
- **Outputs:** Execution instance creation requests to the Execution Engine.
- **Technology:** node-cron (scheduling), Express webhook endpoints, ODW event bus client (adapter-based).

#### Connector Registry & Adapter Layer
- **Responsibility:** Maintains a registry of all available connectors (ODW agent connectors, premium connectors, generic HTTP connector). Each connector is an adapter that translates between Loop's semantic type system and the target system's API. Handles connection lifecycle (health checks, reconnection, version pinning).
- **Inputs:** Node execution requests (from Execution Engine), connector configuration.
- **Outputs:** API calls to external systems (ODW agents, premium services), typed results returned to the engine.
- **Technology:** TypeScript adapter interfaces; per-connector modules (Vault Adapter, Desk Adapter, Recap Adapter, Generic Agent Adapter, Premium Connectors).

#### Code Node Sandbox
- **Responsibility:** Executes user-written Python or TypeScript code in an isolated environment. Enforces resource limits (CPU time, memory, network access). Exposes typed input/output ports. Captures stdout/stderr for execution logs.
- **Inputs:** User code, typed input data, allowed network endpoints (from egress policy).
- **Outputs:** Typed output data, execution logs, error information.
- **Technology:** gVisor (preferred) or Firecracker microVMs for isolation; Python 3.11+ and Node.js runtimes within sandbox.

#### Semantic Type System
- **Responsibility:** Defines and enforces typed objects that flow between nodes (Document, Transcript, ActionItem, Task, CalendarEvent, etc.). Validates type compatibility on edge connections. Enables type-aware node configuration (e.g., a "Summarize" node accepts any Document-like type).
- **Inputs:** Node output values, edge type constraints.
- **Outputs:** Type validation results, coerced/transformed values at node boundaries.
- **Technology:** TypeScript type definitions with runtime validation (Zod schemas); type registry.

#### State Store
- **Responsibility:** Persists all system state: workflow definitions, execution state (in-flight runs), execution history, audit logs, configuration, and credentials.
- **Inputs:** Read/write requests from all services.
- **Outputs:** Persisted data, query results.
- **Technology:** SQLite (Core tier, single-file), PostgreSQL + Redis (Scale tier, distributed).

#### Secrets Manager
- **Responsibility:** Stores and retrieves credentials (API keys, OAuth tokens, passwords) with encryption at rest. Integrates with HashiCorp Vault (Scale tier) or uses encrypted SQLite/PostgreSQL (Core tier). Ensures secrets are never logged or exposed in UI.
- **Inputs:** Secret storage/retrieval requests from connectors and Code Nodes.
- **Outputs:** Decrypted secrets (in-memory, never persisted in plaintext).
- **Technology:** AES-256-GCM encryption; HashiCorp Vault integration (Scale); environment variable fallback.

#### Egress Policy Engine
- **Responsibility:** Enforces data residency and network egress policies. Intercepts all outbound network calls from the Execution Engine and connectors. Blocks calls to non-approved endpoints/regions. Generates audit events for blocked attempts.
- **Inputs:** Outbound connection requests (destination URL/IP), configured egress policies.
- **Outputs:** Allow/deny decisions, audit events for denied requests.
- **Technology:** Network interceptor middleware; DNS resolution + IP geolocation lookup; policy rule engine.

#### Observability Service
- **Responsibility:** Collects execution logs, metrics, and traces. Exposes Prometheus metrics endpoint. Supports OpenTelemetry export. Powers the metrics dashboard and alerting integrations.
- **Inputs:** Structured log entries from all services, execution telemetry, system metrics.
- **Outputs:** Metrics (Prometheus format), log queries, alert notifications (webhook, email, Slack).
- **Technology:** Pino (structured logging), Prometheus client, OpenTelemetry SDK (optional export).

#### Control Plane (Scale Tier)
- **Responsibility:** Unified dashboard for managing multiple Loop instances across regions. Provides fleet-wide workflow deployment, monitoring, and configuration. Enforces cross-region data residency rules. Coordinates failover.
- **Inputs:** Status reports from regional Loop instances, administrator commands.
- **Outputs:** Deployment directives, failover commands, aggregated fleet metrics.
- **Technology:** Separate lightweight service (TypeScript/Node.js); PostgreSQL for fleet state; WebSocket for real-time status.

### 2.2 Component Dependency Graph

```
Loop Canvas → API Gateway → Workflow Authoring Service → Versioning Service → State Store
                            → Execution Engine → Trigger Dispatcher
                                              → Connector Registry → ODW Agents / External APIs
                                              → Code Node Sandbox
                                              → Egress Policy Engine
                                              → State Store
                            → Secrets Manager → State Store / Vault
                            → Observability Service → State Store / Prometheus
Control Plane (Scale) → Regional Loop Instances (API Gateway)
```

---

## 3. Component Interaction & Data Flow

### 3.1 Normal Operation: Event-Driven Workflow Execution

**Scenario:** Recap emits a `transcript.completed` event; Loop runs a workflow that extracts action items, creates Desk tasks, and stores a summary in Vault.

1. **Recap** emits `transcript.completed` on its event bus.
2. **Trigger Dispatcher** receives the event via the Recap Adapter's event listener. It matches the event against registered workflow triggers.
3. **Trigger Dispatcher** creates an Execution Instance in the **Execution Engine**, passing the trigger payload (transcript ID, metadata).
4. **Execution Engine** loads the workflow definition from the **State Store** and begins topological traversal.
5. **Node 1 (Recap → Extract Action Items):** Engine dispatches to the **Connector Registry**, which routes to the Recap Adapter. The adapter calls Recap's extraction API. **Egress Policy Engine** validates the destination (local, allowed). Result (list of action items) is returned as a typed `ActionItem[]`.
6. **Node 2 (Conditional Branch):** Engine evaluates the branch condition against the action item list. For each item, it determines the branch path.
7. **Node 3a/3b (Desk → Create Task):** Engine dispatches to the Desk Adapter via the Connector Registry. Tasks are created with typed inputs (ActionItem → Task mapping).
8. **Node 4 (Recap → Summarize):** Engine dispatches to Recap Adapter for summarization. If an LLM call is needed, the adapter routes through the configured model provider (local Ollama or remote API), subject to egress policy.
9. **Node 5 (Vault → Upsert Document):** Engine dispatches to Vault Adapter. Summary document is stored with metadata tags.
10. **Node 6 (Notification):** Engine dispatches to the notification connector (Slack/email).
11. **Execution Engine** marks the execution as `succeeded`, writes final state to **State Store**, and emits an execution-complete event.
12. **Observability Service** captures the full execution trace (per-node timing, I/O payloads, status).

**Latency budget:** Trigger-to-first-node ≤ 500ms (p95). Per-node engine overhead ≤ 50ms (p95). Total workflow duration dominated by node logic (LLM calls, API latency).

### 3.2 Failure Scenario: Node Failure with Retry

1. A node (e.g., Vault upsert) fails due to a transient network error.
2. **Execution Engine** checks the node's retry configuration (e.g., 3 retries, exponential backoff: 1s, 2s, 4s).
3. Engine pauses the execution, waits for the backoff interval, and re-dispatches the node.
4. If the node succeeds on retry, execution continues normally.
5. If all retries are exhausted:
   - If an error-handling path exists (try/catch node), execution follows that path.
   - If no error-handling path exists, the execution is marked `failed`, an alert is sent via the **Observability Service**, and the audit log records the failure.

### 3.3 Failure Scenario: ODW Agent Unavailable

1. A workflow depends on Vault, but the Vault instance is down.
2. The Vault Adapter's health check detects the failure (connector health monitoring).
3. The node fails immediately (no retry for persistent failures).
4. Execution follows the error-handling path or fails with an alert.
5. Other workflows that do not depend on Vault continue executing normally (graceful degradation).

### 3.4 Async vs. Sync Boundaries

| Boundary | Pattern | Rationale |
|----------|---------|-----------|
| Trigger → Execution Engine | Async (event) | Triggers are fire-and-forget; execution runs independently. |
| Execution Engine → Connector | Sync (request/response) | Node execution is synchronous within a workflow; the engine waits for the connector result before proceeding. |
| Connector → External API | Sync with timeout | Connector calls are blocking; per-node timeout prevents indefinite waits. |
| Execution Engine → State Store | Sync (write-through) | State transitions must be durable before proceeding to the next node. |
| Execution Engine → Observability | Async (fire-and-forget) | Logging/metrics must not block execution. |
| Control Plane → Regional Instances | Async (WebSocket + REST) | Fleet monitoring is eventually consistent; commands are async with acknowledgment. |

---

## 4. API & Service Boundaries

### 4.1 Service Boundaries

| Service | Boundary | Responsibility |
|---------|----------|----------------|
| API Gateway | External-facing | Auth, rate limiting, routing, RBAC enforcement |
| Workflow Authoring Service | Internal (behind gateway) | Workflow CRUD, topology validation |
| Versioning Service | Internal | Git operations, version history |
| Execution Engine | Internal | DAG traversal, node dispatch, state machine |
| Trigger Dispatcher | Internal + external webhook receiver | Event matching, execution creation |
| Connector Registry | Internal | Connector lifecycle, adapter dispatch |
| Code Node Sandbox | Internal (isolated process) | Sandboxed code execution |
| State Store | Internal | Persistent storage |
| Secrets Manager | Internal | Credential storage/retrieval |
| Egress Policy Engine | Internal (middleware) | Network egress enforcement |
| Observability Service | Internal + external (Prometheus scrape) | Logs, metrics, traces, alerts |
| Control Plane | External (Scale tier) | Fleet management, cross-region coordination |

### 4.2 Communication Patterns

| Communication | Pattern | Protocol | Rationale |
|---------------|---------|----------|-----------|
| Canvas → API Gateway | Request/response | REST + WebSocket (real-time execution updates) | Standard CRUD over REST; live execution progress over WebSocket. |
| API Gateway → Internal Services | Synchronous call | In-process function calls (monolith) | No network overhead in Core tier; services are modules within the same process. |
| Execution Engine → Connectors | Synchronous call | In-process (Core) / gRPC (Scale) | Node execution is blocking; gRPC in Scale tier enables cross-node dispatch. |
| Trigger Dispatcher → Execution Engine | Async event | Internal event bus (in-process EventEmitter in Core; NATS/Redis Streams in Scale) | Decouples trigger reception from execution scheduling. |
| ODW Agents → Trigger Dispatcher | Push event | ODW event bus protocol (adapter-specific) | Event-driven triggers require push from agents. |
| Webhook → Trigger Dispatcher | HTTP POST | REST (HTTPS) | Standard webhook pattern with HMAC signature verification. |
| Control Plane → Regional Instances | Bidirectional | WebSocket (status) + REST (commands) | Real-time status updates; reliable command delivery. |
| Prometheus → Observability | Pull | HTTP GET /metrics | Standard Prometheus scrape pattern. |

### 4.3 Contract Expectations

- **Workflow Definition Contract:** JSON schema defining the node graph structure. Versioned; backward-compatible within v1.x. All services consume this contract.
- **Connector Interface Contract:** TypeScript interface defining `execute(input: TypedValue): Promise<TypedValue>`, `healthCheck(): Promise<boolean>`, `getCapabilities(): ConnectorManifest`. All connectors implement this interface.
- **Semantic Type Contract:** Registry of typed objects (Document, Transcript, ActionItem, Task, etc.) with Zod schemas for runtime validation. Connectors produce and consume these types.
- **Event Schema Contract:** Each ODW agent event has a defined schema (event type, payload shape, metadata). Trigger Dispatcher matches against these schemas.
- **Execution State Contract:** State machine definition (pending → running → succeeded/failed/cancelled/paused) with transition rules. All services that read/write execution state conform to this contract.

### 4.4 Decoupling Opportunities

- **Connector Registry** is fully pluggable: new connectors can be added without modifying the Execution Engine.
- **Trigger Dispatcher** uses an adapter pattern: new trigger sources (e.g., file watchers, message queues) are added as adapter modules.
- **State Store** is abstracted behind an interface: SQLite and PostgreSQL implementations are interchangeable.
- **Model Provider** abstraction: LLM calls go through a provider interface; swapping providers requires no engine changes.

---

## 5. Data Architecture

### 5.1 Storage Strategy

| Data Category | Storage Technology | Rationale |
|---------------|-------------------|-----------|
| Workflow definitions | JSON documents in SQLite/PostgreSQL + git repository | JSON enables flexible schema evolution; git provides version history with diff/rollback. |
| Execution state (in-flight) | In-memory (Core) / Redis (Scale) | Hot state needs sub-millisecond access; Redis enables distributed access in Scale tier. |
| Execution history | SQLite (Core) / PostgreSQL (Scale) | Relational model suits the structured execution records with FK relationships. |
| Audit log | Append-only SQLite/PostgreSQL table | Immutable by design; append-only writes; indexed by timestamp and resource. |
| Credentials/secrets | Encrypted blob in SQLite/PostgreSQL; HashiCorp Vault (Scale) | Encryption at rest with deployment-specific keys; Vault integration for enterprise key management. |
| Configuration | SQLite/PostgreSQL key-value store | Simple key-value; small dataset; read-heavy. |
| Execution logs (stdout/stderr) | Structured log files (JSON lines) with rotation | High-volume write; rotation manages disk; searchable via log viewer. |

### 5.2 Data Ownership

| Service | Owns |
|---------|------|
| Workflow Authoring Service | Workflow definitions (JSON), workflow metadata |
| Versioning Service | Git repository (workflow version history) |
| Execution Engine | Execution state (in-flight), node execution records |
| State Store | Execution history, audit log (as storage provider) |
| Secrets Manager | Encrypted credentials |
| Observability Service | Metrics time-series, log indices |
| Egress Policy Engine | Egress policy rules, blocked-endpoint records |
| Control Plane (Scale) | Fleet state, cross-region configuration |

### 5.3 Consistency Model

- **Workflow definitions:** Strong consistency (single-writer; read-after-write guaranteed).
- **Execution state:** Strong consistency for in-flight runs (single execution owner in Core; distributed lock in Scale via Redis).
- **Execution history:** Eventual consistency acceptable (written after execution completes; read for historical queries).
- **Audit log:** Strong consistency (append-only; must be durable before the triggering operation returns).
- **Metrics/observability:** Eventual consistency (acceptable to lose recent metrics under load; never blocks execution).

### 5.4 Indexing Strategy

- **Execution history:** Composite index on `(workflow_id, started_at DESC)` for "last N runs of workflow X" queries. Secondary index on `(status, started_at)` for "all failed runs" queries.
- **Audit log:** Index on `(timestamp DESC)` for time-range queries. Index on `(resource_type, resource_id)` for resource-specific audit trails.
- **Workflow definitions:** Index on `(status, updated_at)` for active workflow listing. Full-text index on `(name, description)` for search.

### 5.5 Data Partitioning (Scale Tier)

- **Execution history:** Partitioned by `started_at` (monthly partitions) for efficient retention-based pruning.
- **Audit log:** Partitioned by `timestamp` (quarterly partitions); old partitions can be archived to cold storage.
- **Multi-region:** Each region owns its execution data; the Control Plane aggregates read-only views. Cross-region writes are prohibited by data residency rules.

---

## 6. Scalability & Performance Design

### 6.1 Scaling Model

| Tier | Scaling Approach | Mechanism |
|------|-----------------|-----------|
| Core | Vertical only | Single instance; scale by adding CPU/RAM to the host. Targets ≤ 50 concurrent executions, ≤ 10K executions/day. |
| Scale | Horizontal (execution plane) | Add execution nodes behind a load balancer. Each node is stateless (state in Redis/PostgreSQL). Linear scaling to 10 nodes. Targets ≤ 200 concurrent executions per node. |
| Scale | Control plane | Single control plane instance (can be HA-paired). Manages fleet coordination, not execution. |

### 6.2 Stateless vs. Stateful Services

| Service | State Model | Rationale |
|---------|-------------|-----------|
| API Gateway | Stateless | No session affinity required; JWT-based auth. |
| Workflow Authoring Service | Stateless (reads/writes to State Store) | All state in database; any instance can serve any request. |
| Execution Engine | Stateful (in-flight executions) | In Core: in-process state. In Scale: Redis-backed; execution can migrate between nodes on failover. |
| Trigger Dispatcher | Stateless (trigger registrations in State Store) | Trigger matching is stateless; registrations are persisted. |
| Connector Registry | Stateless (connector configs in State Store) | Connectors are instantiated per-execution; configs are in DB. |
| Observability Service | Stateless (writes to State Store / external) | Metrics and logs are written through; no local state. |

### 6.3 Bottlenecks & Mitigations

| Bottleneck | Mitigation |
|------------|------------|
| SQLite write contention (Core tier, >50 concurrent writes) | Cap Core tier at 50 concurrent executions; use WAL mode for concurrent reads during writes. Scale tier uses PostgreSQL. |
| LLM inference latency (node-level) | Prompt caching; batch inference where possible; model selection guidance (small models for classification, large for generation); async node execution for non-blocking workflows. |
| Execution history growth (disk/memory) | Configurable retention (default 30 days for full I/O); partition pruning; summary records retained longer with reduced payload. |
| Webhook trigger throughput | Async ingestion (queue webhook POSTs, process in background); rate limiting per webhook source. |
| Code Node cold start (sandbox creation) | Pre-warmed sandbox pool (Scale tier); sandbox reuse for same-workflow executions; gVisor preferred over Firecracker for faster cold start. |

### 6.4 Caching Layers

| Cache | Scope | TTL | Purpose |
|-------|-------|-----|---------|
| Workflow definition cache | In-memory (per execution node) | Until next version save | Avoid DB read on every execution start. |
| Connector capability cache | In-memory | 5 minutes | Avoid repeated `getCapabilities()` calls to ODW agents. |
| Egress policy cache | In-memory | Until policy change | Avoid DB read on every outbound call. |
| LLM response cache (optional) | Configurable (Redis in Scale) | Workflow-defined | Deduplicate identical inference calls within a time window. |

### 6.5 Load Balancing (Scale Tier)

- **Execution nodes:** Least-connections load balancing. Executions are dispatched to the node with the fewest active runs.
- **API requests:** Round-robin (stateless services).
- **Webhook ingestion:** Sticky by webhook ID (ensures ordering for sequential events from the same source).

### 6.6 Rate Limiting & Throttling

- **API Gateway:** Token bucket per user (configurable; default 100 req/min for read, 20 req/min for write).
- **Webhook triggers:** Per-source rate limit (default 60 events/min); excess events are queued with backpressure.
- **Connector calls:** Per-connector rate limit (respecting external API rate limits); queue-based throttling.
- **Code Node execution:** Per-workflow concurrency limit (default 5 concurrent Code Node executions per workflow).

---

## 7. Reliability & Fault Tolerance

### 7.1 Failover Strategy

| Component | Failover Approach | RTO |
|-----------|-------------------|-----|
| Execution Engine (Core) | Process restart with state recovery from SQLite | ≤ 30s |
| Execution Engine (Scale) | Active-active; failed node's in-flight executions re-assigned to surviving nodes via Redis | ≤ 60s |
| State Store (Core) | SQLite WAL; filesystem-level backup | N/A (single-node) |
| State Store (Scale) | PostgreSQL streaming replication (sync or async) | ≤ 30s |
| Redis (Scale) | Redis Sentinel or Cluster; automatic failover | ≤ 15s |
| API Gateway (Scale) | Multiple instances behind load balancer; failed instance removed from pool | ≤ 10s |
| ODW Agent dependency | Graceful degradation; workflows not dependent on the failed agent continue; dependent workflows fail with clear error | Immediate |

### 7.2 Retry Mechanisms

- **Node-level retry:** Configurable per node (count, backoff strategy: exponential/linear/fixed). Default: 3 retries, exponential backoff (1s, 2s, 4s).
- **Connector-level retry:** Connectors implement internal retry for transient HTTP errors (5xx, timeouts) before reporting failure to the engine.
- **Trigger delivery retry:** Webhook triggers use at-least-once delivery with idempotency keys; failed webhook deliveries are retried with exponential backoff (5s, 30s, 5min, 30min).
- **State store write retry:** Write operations to the state store are retried on transient failures (lock contention, connection drops) with immediate retry (up to 3 attempts).

### 7.3 Circuit Breakers

- **Per-connector circuit breaker:** If a connector (e.g., Vault) fails N consecutive times (default: 5), the circuit opens. Subsequent calls fail immediately without attempting the external call. Circuit half-opens after a cooldown period (default: 30s) to test recovery.
- **Per-LLM-provider circuit breaker:** If a model provider (e.g., OpenAI) fails consecutively, the circuit opens and the engine can fall back to an alternative provider (if configured).
- **Circuit breaker state is observable:** Exposed via metrics dashboard; alerts fire when circuits open.

### 7.4 Graceful Degradation

- **ODW agent down:** Workflows not dependent on that agent execute normally. Dependent workflows fail at the affected node with a clear error message. No cascading failures.
- **LLM provider down:** If local models are available, the engine falls back to local inference. If all providers are down, LLM-dependent nodes fail; non-LLM workflows continue.
- **State store read latency:** Workflow definition cache absorbs reads; execution history queries may timeout but do not block execution.
- **Observability service down:** Execution continues; metrics/logs are buffered locally and flushed when the service recovers (bounded buffer to prevent memory exhaustion).

### 7.5 Single Points of Failure & Mitigations

| SPOF | Mitigation |
|------|------------|
| Core tier: single process | Process supervisor (systemd/Docker restart policy); state recovery from SQLite on restart. |
| Scale tier: Redis | Redis Sentinel for automatic failover; execution state can be reconstructed from PostgreSQL if Redis is lost (with in-flight execution loss). |
| Scale tier: PostgreSQL | Streaming replication; automated failover via Patroni or cloud-managed HA. |
| ODW agent APIs | Adapter layer with health monitoring; circuit breakers; workflows designed with error-handling paths. |
| Git repository (versioning) | Local bare repository; optional remote push for backup. Versioning failure does not block execution. |

---

## 8. Security Architecture

### 8.1 Authentication & Authorization

- **Authentication:** Local username/password (Core tier, bcrypt-hashed); OIDC/SAML SSO integration (Scale tier). API key authentication for programmatic access.
- **Authorization:** Role-Based Access Control (RBAC) with three roles:
  - **Read:** View workflows, execution history, dashboards. Cannot edit or execute.
  - **Write:** Create/edit/execute workflows. Cannot modify system configuration or RBAC.
  - **Admin:** Full access including RBAC management, system configuration, secrets management.
- **Token model:** JWT tokens (short-lived, 15-minute access tokens; refresh tokens with configurable expiry). Tokens carry role claims; validated at API Gateway on every request.

### 8.2 Data Protection

| Layer | Mechanism |
|-------|-----------|
| Encryption at rest | AES-256-GCM for execution I/O payloads, credentials, and sensitive configuration. Encryption key derived from deployment-specific master key (stored in env var or HashiCorp Vault). |
| Encryption in transit | TLS 1.3 for all HTTP/WebSocket connections. Internal service communication uses mTLS in Scale tier (Kubernetes service mesh or manual cert management). |
| Secret masking | Secrets are never logged, never returned in API responses, and displayed as `****` in the UI. Code Nodes access secrets via a scoped secrets API; values are injected at runtime, never embedded in code. |
| Execution I/O redaction | Configurable redaction policies: sensitive fields (PII, credentials) can be redacted from execution history views while preserved in encrypted storage for audit purposes. |

### 8.3 Secrets Management

- **Core tier:** Secrets encrypted with AES-256-GCM, stored in SQLite. Master key provided via environment variable.
- **Scale tier:** HashiCorp Vault integration (preferred) or encrypted PostgreSQL. Vault provides dynamic secrets, automatic rotation, and audit logging.
- **Fallback:** Environment variables for simple deployments. Secrets in env vars are never logged or exposed via the API.

### 8.4 API Security

- **Authentication required** on all endpoints (except health check).
- **Rate limiting** at API Gateway (per-user, per-endpoint).
- **Input validation** on all endpoints (JSON schema validation, parameterized queries to prevent SQL injection).
- **Webhook signature verification** (HMAC-SHA256) for all inbound webhooks.
- **CORS** restricted to configured origins.
- **Content Security Policy** headers on all UI responses.

### 8.5 Code Node Sandboxing

- **Isolation:** gVisor (preferred) or Firecracker microVMs. Code Nodes run in an isolated environment with no access to the host filesystem, host network, or other workflow executions.
- **Network restrictions:** Code Node network access is governed by the Egress Policy Engine. By default, no outbound network access is permitted; allowed endpoints must be explicitly whitelisted.
- **Resource limits:** CPU time limit (configurable, default 30s per execution), memory limit (default 256MB), no access to system calls outside the allowed set.
- **Dependency restrictions:** Only a curated set of Python/Node.js packages are available in the sandbox (no arbitrary package installation at runtime).

### 8.6 Threat Considerations

| Threat | Mitigation |
|--------|------------|
| Injection (SQL, command) | Parameterized queries; no shell execution; input validation at API Gateway. |
| Sandbox escape (Code Node) | gVisor/Firecracker isolation; regular penetration testing; bug bounty program post-GA. |
| Credential theft | Secrets encrypted at rest; never logged; scoped access; rotation support. |
| Unauthorized workflow execution | RBAC enforcement; API key scoping; audit logging of all executions. |
| Data exfiltration via connectors | Egress Policy Engine blocks unauthorized outbound connections; all external endpoints are logged. |
| Supply chain attack (dependencies) | Dependency vulnerability scanning on every PR; locked dependency versions; minimal dependency surface. |
| Denial of service | Rate limiting; execution concurrency limits; resource limits on Code Nodes. |

---

## 9. Infrastructure & Deployment Architecture

### 9.1 Deployment Model

Loop is **self-hosted only**. ODW.ai does not operate Loop as a managed SaaS. Customers deploy on their own infrastructure — on-premises, private cloud, or IaaS VMs.

### 9.2 Containerization & Orchestration

| Tier | Container Runtime | Orchestration | Deployment Method |
|------|-------------------|---------------|-------------------|
| Core | Docker | Docker Compose | Single `docker compose up -d` command |
| Scale | Docker (containerd) | Kubernetes | Helm chart (single-cluster or multi-cluster) |

**Core tier Docker Compose services:**
- `loop-app`: Main application (API Gateway + all monolith services)
- `loop-worker`: Execution engine worker (can be co-located with app or separate)
- `loop-db`: SQLite (bind-mounted volume) or optional PostgreSQL sidecar
- `loop-sandbox`: Code Node sandbox runtime (gVisor-enabled)

**Scale tier Kubernetes deployment:**
- `loop-api`: API Gateway + control plane services (Deployment, HPA)
- `loop-engine`: Execution engine nodes (StatefulSet or Deployment, HPA)
- `loop-sandbox`: Code Node sandbox pods (DaemonSet or pool)
- `loop-db`: PostgreSQL (StatefulSet or managed cloud DB)
- `loop-redis`: Redis (StatefulSet or managed cloud Redis)
- `loop-control-plane`: Control plane service (Scale tier only, Deployment)

### 9.3 Environments

| Environment | Purpose | Infrastructure |
|-------------|---------|----------------|
| Development | Local development, unit/integration tests | Docker Compose on developer machine |
| Staging | Pre-production validation, acceptance tests | Kubernetes cluster (single-node OK) |
| Production | Customer deployment | Customer's infrastructure (on-prem, private cloud, IaaS) |

### 9.4 CI/CD Approach

- **Source control:** Git (monorepo for Loop codebase).
- **CI pipeline:** On every PR: lint, type-check, unit tests, integration tests, dependency vulnerability scan, container image build.
- **CD pipeline:** On merge to main: build release container images, push to registry, generate Helm chart updates, create release artifacts (Docker Compose files, signed tarballs for air-gapped installs).
- **Release process:** Semantic versioning. Automated changelog generation. Release candidates tagged for staging validation before GA promotion.
- **Air-gapped updates:** Signed offline update packages (tarballs containing container images + migration scripts). Customers import via USB or internal registry.

### 9.5 Air-Gapped Deployment

- All dependencies bundled in container images (no runtime package downloads).
- No outbound network required (no telemetry, no update checks, no cloud callbacks).
- Model serving via local providers only (Ollama, vLLM, llama.cpp) — no remote LLM APIs.
- Update mechanism: signed tarballs imported manually or via internal registry.

---

## 10. Observability & Operations

### 10.1 Logging Strategy

- **Structured logging:** All services emit JSON-formatted log entries (via Pino) with correlation IDs (execution ID, node ID, request ID) for traceability.
- **Log levels:** DEBUG, INFO, WARN, ERROR. Default production level: INFO. Configurable per service.
- **Log storage:** Local JSON-line files with rotation (size-based and time-based). Configurable retention (default 7 days for Code Node stdout/stderr; execution logs tied to execution history retention).
- **Log search:** Built-in log viewer in the UI (filtered by execution, node, level, time range). External log aggregation (ELK, Loki) supported via file forwarding or stdout collection.

### 10.2 Metrics Collection

- **Prometheus endpoint:** `/metrics` on each service (API Gateway, Execution Engine). Exposes:
  - Workflow execution counters (started, succeeded, failed, cancelled)
  - Execution latency histograms (p50, p95, p99)
  - Node execution latency (per node type)
  - Connector call latency and error rates
  - Queue depth (pending executions)
  - System metrics (CPU, memory, disk)
- **Dashboard:** Built-in metrics dashboard in the UI (success rate, latency, throughput, active executions). Grafana dashboards provided as pre-built templates for external monitoring.

### 10.3 Distributed Tracing

- **Core tier:** Correlation IDs propagated through execution (execution ID → node ID → connector call ID). Visible in execution detail view.
- **Scale tier:** OpenTelemetry SDK integrated; traces exportable to Jaeger, Zipkin, or any OTLP-compatible backend. Trace spans cover: trigger reception → execution start → each node execution → connector calls → completion.

### 10.4 Alerting & Monitoring

- **Built-in alerting:** Configurable alert rules (execution failure rate > threshold, latency > threshold, connector health degradation). Alert channels: webhook, email, Slack.
- **External monitoring:** Prometheus metrics can be scraped by external Prometheus instances; alerting via Alertmanager.
- **Health checks:** `/health` endpoint on all services (liveness) and `/ready` endpoint (readiness, checks DB/Redis connectivity). Kubernetes probes configured in Helm chart.
- **Data Flow Map:** Visual graph showing all external endpoints contacted by workflows in a configurable time window. Enables compliance officers to verify data sovereignty.

### 10.5 Audit Logging

- **Immutable, append-only** audit log records every state-changing operation: workflow created/updated/deleted, execution started/completed/failed, configuration changed, user role modified, secret accessed.
- **Each audit event** includes: timestamp, actor (user or system), action, resource type, resource ID, details (JSON), IP address.
- **Export:** Audit logs exportable as signed PDF (for external auditors) or JSON/CSV (for programmatic analysis).
- **Retention:** Unlimited (append-only by design; never deleted).

---

## 11. Cost & Resource Considerations

### 11.1 Major Cost Drivers

| Driver | Core Tier | Scale Tier |
|--------|-----------|------------|
| Compute | Single VPS (2 CPU, 4GB RAM minimum) | Multiple K8s nodes (scales with execution throughput) |
| Storage | SQLite file (minimal) + execution history (grows with usage) | PostgreSQL + Redis (scales with execution volume and history retention) |
| LLM inference | Local models (GPU cost) or remote API calls (per-token cost) | Same, but at higher volume; priority queues may require dedicated inference capacity |
| Network | Minimal (air-gapped possible) | Cross-region replication traffic (Scale tier multi-region) |
| Engineering | Maintenance of single deployment | Control plane, HA operations, premium connector maintenance |

### 11.2 Resource Budget (Core Tier, Idle)

- **RAM:** ≤ 2GB (application + SQLite + sandbox pool)
- **CPU:** ≤ 2 cores (idle); burstable to available cores during execution
- **Disk:** ~500MB (application + dependencies); execution history grows with usage (~1MB per execution with full I/O)

### 11.3 Optimizations

| Optimization | Impact | Mechanism |
|--------------|--------|-----------|
| LLM prompt caching | Reduces inference cost by 30-60% for repetitive workflows | Cache identical prompts within a configurable TTL; prefix caching for similar prompts. |
| Batch inference | Reduces per-call overhead for bulk operations | Group multiple classification/extraction calls into a single batched LLM call. |
| Execution history pruning | Controls storage growth | Configurable retention; automatic pruning of full I/O after retention period (summary records retained). |
| Sandbox pool reuse | Reduces Code Node cold-start latency and compute overhead | Pre-warmed sandboxes reused across executions of the same workflow. |
| Workflow definition caching | Eliminates DB reads on execution start | In-memory cache invalidated on workflow save. |
| Model selection guidance | Right-sizes inference cost | Documentation and templates guide users to small models for classification, large models for generation. |

---

## 12. Trade-offs & Design Decisions

### 12.1 Modular Monolith vs. Microservices (Core Tier)

- **Options considered:** Full microservices, modular monolith, serverless functions.
- **Chosen:** Modular monolith.
- **Pros:** Single deployment unit (minimal ops burden for SMB); no inter-service network overhead; simpler debugging; single process for Core tier.
- **Cons:** Cannot scale individual services independently; larger blast radius for bugs; requires discipline to maintain module boundaries.
- **Justification:** Core tier targets single-instance deployments where microservice complexity provides no benefit. Scale tier decomposes the monolith into deployable services. Module boundaries are enforced via internal interfaces, enabling future decomposition.

### 12.2 SQLite vs. PostgreSQL (Core Tier)

- **Options considered:** PostgreSQL (always), SQLite, embedded DB (DuckDB).
- **Chosen:** SQLite for Core, PostgreSQL for Scale.
- **Pros:** Zero configuration (no separate database process); single-file backup; ships with the application; sufficient for ≤ 50 concurrent executions.
- **Cons:** Limited write concurrency; no built-in replication; less mature tooling for large datasets.
- **Justification:** Core tier customers prioritize simplicity over scalability. SQLite WAL mode handles the target concurrency. Clean migration path to PostgreSQL for Scale tier.

### 12.3 gVisor vs. Firecracker vs. Docker (Code Node Sandbox)

- **Options considered:** Docker containers (no isolation), gVisor (user-space kernel), Firecracker microVMs (lightweight VMs), WASM (WebAssembly).
- **Chosen:** gVisor (preferred), Firecracker (fallback).
- **Pros (gVisor):** Faster cold start (~200ms vs ~125ms Firecracker but simpler ops); strong syscall filtering; compatible with standard Linux binaries.
- **Cons (gVisor):** Some syscall incompatibilities; slightly higher overhead than raw containers.
- **Justification:** gVisor provides adequate isolation with acceptable performance. Firecracker is the fallback if gVisor proves incompatible with required Python/Node.js operations. Docker-only is rejected as insufficient for multi-tenant security.

### 12.4 In-Process Execution vs. External Queue (Core Tier)

- **Options considered:** External message queue (Redis/RabbitMQ/NATS) for all execution dispatch; in-process event loop.
- **Chosen:** In-process for Core; external queue (Redis Streams / NATS) for Scale.
- **Pros:** No external dependency for Core tier; simpler deployment; lower latency (no network hop).
- **Cons:** Cannot distribute executions across nodes; process crash loses in-flight state (mitigated by state recovery from SQLite).
- **Justification:** Core tier is single-instance by design; an external queue adds operational complexity without benefit. Scale tier introduces distributed execution with Redis-backed state.

### 12.5 Git-Backed Versioning vs. Internal VFS

- **Options considered:** Internal versioned file store, git-backed storage, database-only versioning.
- **Chosen:** Git-backed (libgit2 bundled).
- **Pros:** Power-user friendly (direct git access); enables CI/CD integration; industry-standard diff/merge tooling; portable.
- **Cons:** Adds git dependency; non-engineers may not understand git concepts.
- **Justification:** Git is abstracted behind the UI ("versions" not "commits"). Power users benefit from direct git access. The dependency is minimal (libgit2 is bundled). Alternative (internal VFS) would require building version-control primitives from scratch.

### 12.6 Event-Driven Triggers vs. Polling

- **Options considered:** Polling ODW agent APIs on a schedule; event-driven (push from agents).
- **Chosen:** Event-driven (primary) with polling fallback.
- **Pros:** Sub-second trigger latency; lower resource usage (no polling overhead); real-time responsiveness.
- **Cons:** Requires ODW agents to expose event buses; tighter coupling to agent event schemas.
- **Justification:** Event-driven is essential for the "meeting ends → workflow starts" use case. Polling fallback ensures compatibility with agents that don't yet support events. Adapter layer abstracts the difference.

---

## 13. Risks & Mitigations

### 13.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ODW agent API instability breaks connectors | High | High | Stable integration contracts (OpenAPI specs); adapter layer absorbs changes; version-pinned connectors; contract tests in CI. |
| Code Node sandbox escape | Low | Critical | gVisor/Firecracker isolation; regular penetration testing; bug bounty program; minimal attack surface (no host filesystem/network). |
| SQLite write contention under load (Core) | Medium | Medium | Hard cap on concurrent executions (50); WAL mode; clear upgrade path to PostgreSQL (Scale tier). |
| Local LLM performance insufficient for production | Medium | Medium | Early benchmarking; hardware requirement documentation; remote API fallback (with sovereignty warnings); prompt optimization. |
| Air-gapped deployment breaks on update | Medium | Low | Signed offline update packages; documented air-gapped update procedure; automated compatibility checks. |
| Git-backed versioning complexity for non-engineers | Low | Medium | UI abstraction ("versions" not "commits"); optional git access for power users; no git knowledge required for normal use. |
| Multi-region HA (Scale) harder than expected | Medium | Medium | Start with active-passive (simpler); promote to active-active in v1.1 if demand warrants; leverage cloud-managed HA for PostgreSQL/Redis. |
| Execution state loss on process crash (Core) | Low | Medium | State recovery from SQLite on restart; in-flight executions are re-queued or marked as failed with recovery option. |

### 13.2 External Dependency Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| ODW agent modules (Vault, Desk, Recap) | API changes, delayed stability | Early integration contracts; adapter layer; version pinning; fallback to generic connector. |
| gVisor / Firecracker | Project discontinuation, incompatibility | Support both; abstract behind sandbox interface; Docker-only fallback (with security warnings). |
| LLM providers (OpenAI, Anthropic, etc.) | API changes, pricing changes, availability | Provider abstraction layer; multi-provider support; local model fallback. |
| React / Node.js ecosystem | Breaking changes, security vulnerabilities | Locked dependency versions; automated vulnerability scanning; minimal dependency surface. |

---

## 14. Assumptions & Constraints

### 14.1 Assumptions

| # | Assumption | Risk if Wrong |
|---|------------|---------------|
| A1 | ODW agents expose stable APIs and event buses with published OpenAPI specs and event schemas | High — connector development blocked; launch delayed |
| A2 | Target customers have Docker/Kubernetes expertise or access to someone who does | Medium — reduces addressable market; increases support burden |
| A3 | Local LLMs (Ollama, vLLM) deliver acceptable latency on commodity hardware (≤ 5s for typical workflow inference) | Medium — users forced to remote APIs; sovereignty story weakened |
| A4 | SMBs in regulated industries prioritize sovereignty enough to accept self-hosting complexity | Medium — market smaller than projected |
| A5 | SQLite handles Core-tier concurrency (≤ 50 concurrent executions) without unacceptable contention | Low — can reduce cap if needed |
| A6 | gVisor provides adequate sandboxing with < 200ms cold start on target hardware | Low — Firecracker as fallback |
| A7 | Git (libgit2) can be bundled without significant binary size increase or platform compatibility issues | Low — isomorphic-git as fallback |
| A8 | Premium connectors (SAP, Salesforce, ServiceNow) can be built within 6 months by a small team | Medium — Scale tier GA delayed |

### 14.2 Constraints

| # | Constraint | Impact |
|---|------------|--------|
| C1 | Must run fully air-gapped (zero outbound network) | Cannot depend on cloud services at runtime; all dependencies bundled; no mandatory telemetry |
| C2 | No telemetry without explicit opt-in | Reduced product analytics; must rely on self-reported feedback and opt-in deployment pings |
| C3 | Open-core model (Apache 2.0 core) | Proprietary differentiation limited to Scale-tier features; community can fork |
| C4 | Must integrate with ODW agents as they exist today (APIs may evolve) | Adapter layer required; tight coupling mitigated by interface abstraction |
| C5 | Target market is SMB (price-sensitive, small IT teams) | UX must be simpler than enterprise tools; documentation must be excellent; one-command install required |
| C6 | v1.0 must ship within 9 months | P0 features only; P2 deferred; scope discipline required |
| C7 | Code Node must be sandboxed (no host access) | Limits custom code capabilities; must provide rich built-in primitives to compensate |
| C8 | Must support ≥ 5 LLM providers at launch | Engineering effort for provider abstraction; each provider has different API shapes |
| C9 | Single-tenant by design (no multi-tenant SaaS isolation) | Each deployment serves one organization; simplifies data model but limits hosting options |

---

## 15. Future Evolution & Extensibility

### 15.1 Extension Points

| Extension Point | Mechanism | Example |
|-----------------|-----------|---------|
| New ODW agent modules | Generic Agent Connector (auto-discover via manifest) + custom adapter | New "Sentinel" compliance agent integrated via manifest |
| New node types | Plugin architecture (register custom node type with input/output schema, execution logic) | Custom "Data Masking" node for PHI handling |
| New trigger sources | Trigger adapter interface (implement `subscribe()` and `parse()`) | File watcher trigger, Kafka consumer trigger |
| New LLM providers | Provider interface (implement `complete()`, `embed()`, `stream()`) | New open-source model provider |
| New state backends | State store interface (implement CRUD + query operations) | CockroachDB, TiDB for geo-distributed Scale deployments |
| New premium connectors | Connector SDK (Python) with standardized interface | Custom ERP connector built by customer |
| New notification channels | Notification adapter interface | Microsoft Teams, PagerDuty, SMS |

### 15.2 Feature Evolution Path

| Release | Feature | Architectural Impact |
|---------|---------|---------------------|
| v1.1 | Natural-language workflow generation | Adds LLM-powered authoring service; consumes workflow definition API |
| v1.1 | Active-active multi-region HA | Control Plane gains consensus layer (Raft); execution state replication |
| v1.2 | Workflow marketplace (community templates) | Template registry service; signed template distribution |
| v1.2 | Multi-player canvas (real-time collaboration) | WebSocket-based CRDT sync for workflow definitions |
| v2.0 | Cross-organization workflow federation | Federation protocol; cross-org trust establishment; data residency across org boundaries |
| v2.0 | Edge deployment (IoT/branch office) | Lightweight edge runtime; sync protocol for workflow definitions and execution results |

### 15.3 Scaling Evolution

- **Current (v1.0):** Linear scaling to 10 execution nodes (Scale tier). Single control plane.
- **Near-term (v1.1):** Hierarchical control plane (regional control planes federated under a global plane). Scaling to 50+ execution nodes.
- **Long-term (v2.0):** Geo-distributed execution with data locality awareness. Edge nodes with intermittent connectivity. Consensus-based workflow scheduling.

### 15.4 Backward Compatibility Guarantee

- Workflow definitions from v1.0 will execute on any v1.x release without modification.
- Breaking changes to the workflow definition schema require a migration tool and a major version bump (v2.0).
- Connector interfaces are versioned; deprecated interfaces supported for ≥ 2 minor versions before removal.
- State store schema migrations are automated (applied on startup); rollback supported via backup.

---

## 16. Reference Architecture Patterns (Added 2026-06-24)

Based on deep architectural analysis of 6 reference repositories (Activepieces, n8n, Flowise, Trigger.dev, Inngest, Windmill) and research of 12 open-source workflow/agent orchestration platforms.

### 16.1 Execution Engine Patterns

**Three dominant execution models observed:**

| Model | Used By | Pros | Cons | Fit for Loop |
|-------|---------|------|------|-------------|
| Worklist/Stack Interpreter | n8n | Simple, handles multi-input joins elegantly | No intra-workflow parallelism | ✅ Core tier |
| Modular Subsystem Composition | Trigger.dev | Testable, evolvable, composable | More complex to implement | ✅ Scale tier |
| Event Sourcing + Replay | Temporal | Full durability, deterministic replay | Requires deterministic workflow code | ⚠️ Overkill for Core |

**n8n's Worklist Interpreter (recommended for Core tier):**
- Stack-driven: `while (nodeExecutionStack.length !== 0)` — shifts one node, executes it, fans out to downstream
- Multi-input join via `waitingExecution` map — node waits until ALL inputs arrive before executing
- Two adjacency maps (by source, by destination) enable both forward and backward traversal
- Separation of pure graph model (`Workflow`) from execution state (`IRunExecutionData`)
- Source: `reference/n8n/packages/core/src/execution-engine/workflow-execute.ts`

**Trigger.dev's Modular Subsystems (recommended for Scale tier):**
- 12 independent systems: EnqueueSystem, DequeueSystem, ExecutionSnapshotSystem, CheckpointSystem, WaitpointSystem, RunAttemptSystem, BatchSystem, DelayedRunSystem, DebounceSystem, TTLSystem, PendingVersionSystem
- Each system is independently testable and evolvable
- Immutable execution snapshots chained via `previousSnapshotId` provide audit trail and recovery
- Source: `reference/trigger.dev/internal-packages/run-engine/src/engine/`

**Recommendation:** Adopt hybrid approach — topological sort (Kahn's algorithm per TSD §6.2) for ordering + worklist stack for execution + join map for multi-input nodes + modular subsystem composition for code organization.

### 16.2 Durable Execution & Recovery

**Trigger.dev's Waitpoint Pattern (relevant for ENGINE-006 approval nodes):**
1. SDK calls `triggerAndWait()` → creates Waitpoint in DB
2. `runtime.waitUntil()` suspends promise chain
3. Worker sends `SET_SUSPENDABLE` via IPC → container checkpointed via CRIU
4. External event completes waitpoint
5. `WaitpointSystem.completeWaitpoint()` → enqueues `continueRunIfUnblocked`
6. Worker dequeues, IPC resolves promise → task continues from exact suspension point

**Loop adaptation:** For Core tier, use simpler in-process pausing + SQLite state persistence (no CRIU). For Scale tier, consider CRIU checkpoint/restore for long-running workflows with approval gates.

**Execution State Machine (Trigger.dev's extended model):**
```
RUN_CREATED → DELAYED → QUEUED → PENDING_EXECUTING → EXECUTING
                                    → EXECUTING_WITH_WAITPOINTS
                                    → SUSPENDED (checkpointed)
                                    → QUEUED (re-enqueued after resume)
                                    → FINISHED
```
This extends our TSD §4.3 state machine with WAITPOINTS and SUSPENDED states for human-in-the-loop.

### 16.3 Sandboxing & Code Execution

**⚠️ Critical Security Finding:**
- **n8n CVE-2025-68668** (severity 9.9): Pyodide WASM sandbox escape enabling full RCE
- **n8n CVE-2025-68613**: Node.js VM sandbox escape enabling full RCE
- **vm2 CVE-2026-22709**: Critical sandbox escape enabling arbitrary code execution

**Lesson:** VM/WASM-based sandboxing alone is INSUFFICIENT for Code Node execution. Loop MUST use OS-level isolation (gVisor or Firecracker) as specified in SAD §8.5 and TSD §2.3.

**Sandboxing approaches observed:**
| Approach | Used By | Security Level | Loop Relevance |
|----------|---------|---------------|---------------|
| V8 Isolate | Activepieces | Medium | ❌ Insufficient alone |
| Node.js VM / WASM | n8n | Low (CVEs) | ❌ Broken |
| Docker per execution | AutoGen, Airflow K8sExecutor | High | ⚠️ Cold start too slow |
| gVisor | E2B, recommended | High | ✅ Primary choice |
| Firecracker microVM | E2B, Trigger.dev | Very High | ✅ Fallback |
| Deno permissions | Windmill | Medium-High | ⚠️ TypeScript only |

**E2B reference (Apache 2.0):** `reference/` (not cloned — clone separately if needed). E2B's Firecracker-based sandbox lifecycle (create → execute → destroy with pool management for warm starts) is the closest reference for our `loop-sandbox` design.

### 16.4 Credential & Secret Management

**n8n's Envelope Encryption (production-grade, directly applicable):**
- Two-tier hierarchy: Instance Key (env var) → DEK-wrapping key (AES-256-GCM) → Data Encryption Keys (stored in DB) → Credential JSON blobs
- HKDF key derivation from instance key
- Key rotation support: ciphertext prefixed with keyId for version-aware decryption
- Source: `reference/n8n/packages/core/src/encryption/aes-256-gcm.ts`

**n8n's Credential Flow (reference for SEC-002):**
1. Node declares credential requirements in `INodeType.description.credentials`
2. User selects credential in UI → stored as `INodeCredentials` on `INode`
3. At execution: `CredentialsHelper.getDecrypted()` → load entity → decrypt blob → apply defaults/overwrites → return decrypted object
4. Node accesses via `this.getCredentials('credentialType')`
5. OAuth2 auto-refresh on 401 with token persistence

**Loop adaptation:** Our TSD §11.4 uses single-key AES-256-GCM. Consider adopting n8n's envelope encryption with key rotation for Scale tier (HashiCorp Vault integration).

### 16.5 Frontend Visual Builder

**React Flow is the de facto standard** for visual workflow editors in the React ecosystem:
- Used by Flowise, Langflow, Activepieces, and many others
- Activepieces' canvas architecture (closest reference):
  - `useCanvasMapping()` composable transforms workflow document → React Flow nodes/edges (reactive)
  - Per-workflow store instances
  - Custom node types with typed input/output handles
  - Dagre library for automatic graph layout ("tidy up")
- Source: `reference/activepieces/packages/web/src/` (canvas components)
- Source: `reference/Flowise/packages/ui/src/` (React Flow usage)

**n8n's execution visualization (reference for FE-004):**
- WebSocket (preferred) or SSE fallback for real-time updates
- Per-node status: running (animated), waiting (amber), success (green edges), error (red)
- Edge colors reflect data flow status
- Source: `reference/n8n/packages/frontend/editor-ui/src/`

### 16.6 Trigger & Event System

**Three trigger patterns cover 99% of use cases (from n8n):**
1. **Active Triggers (event-based):** Keep listeners open (WebSocket, SSE, MQTT), emit on events
2. **Polling Triggers:** Cron-scheduled API polling with state persistence between polls
3. **Webhook Triggers:** HTTP route registration on workflow activation, DB persistence + caching

**Webhook architecture (from n8n, reference for TRIG-003):**
- DB persistence + in-memory cache + atomic registration (prevents path conflicts)
- Dynamic paths with `:param` segments
- 5 response modes: immediate, wait-for-completion, explicit-response, form, streaming
- Source: `reference/n8n/packages/cli/src/` (webhook handling)

### 16.7 Error Handling Patterns

**n8n's three-tier error handling (reference for ENGINE-004/006):**
1. **Retry:** Configurable per node (count + delay), clamped between 2-5 attempts, 0-5000ms delay
2. **Continue-on-fail:** Pass input data through to next node on error
3. **Error output channel:** Route errors to dedicated error output with paired-item tracing back to original inputs, creating visual error branches in the canvas
4. **Error workflows:** Designated workflow that runs when another fails, with anti-loop guard

**Trigger.dev's error classification (reference for ENGINE-004):**
- Always retry: Uncaught exceptions, crashes, segfaults
- Never retry: Cancellations, timeouts, OOM, heartbeat timeouts, deadlocks
- Decision tree: Cancel check → OOM (retry on larger machine) → error classification → max attempts → delay strategy
- Source: `reference/trigger.dev/internal-packages/run-engine/src/engine/`

### 16.8 Node/Connector Architecture

**n8n's node definition pattern (reference for CONN-001):**
```
INodeType.description  → Metadata (name, version, inputs, outputs, properties, credentials)
INodeType.execute()    → Behavior (process data, return results)
INodeProperties[]      → UI config (form fields, conditional visibility)
NodeConnectionType     → Typed connections (main, ai_tool, ai_memory, ai_output_parser)
```
- Typed connections enable specialized ports for AI workflows — critical for our semantic type system
- Source: `reference/n8n/packages/workflow/src/` (interfaces)

**Activepieces' piece SDK pattern (reference for CONN-001):**
- Each piece is self-contained with `actions`, `triggers`, and `auth` definitions
- Type-safe TypeScript throughout — shared data models between frontend, backend, and pieces
- Source: `reference/activepieces/packages/pieces/`

### 16.9 Technology Stack Validation

| TSD Choice | Validated By | Notes |
|-----------|-------------|-------|
| TypeScript 5.3+ | Activepieces, Trigger.dev, n8n | Industry standard for workflow engines |
| React 18 | Activepieces, Flowise, Langflow | Dominant frontend framework |
| React Flow 11 | Flowise, Activepieces, Langflow | De facto visual workflow editor |
| Fastify 4 | Activepieces | High-performance HTTP server |
| Zustand 4 | Activepieces | Lightweight state management |
| Drizzle ORM | Modern TypeScript projects | Type-safe SQL, lighter than TypeORM |
| Zod 3.22+ | Activepieces, Trigger.dev | Runtime validation, schema inference |
| Vitest | Activepieces, Trigger.dev | Fast TypeScript-native testing |
| pnpm workspaces | All reference repos | Standard monorepo tooling |
| SQLite (Core) | Activepieces, n8n dev, Restate | Validated for single-instance |
| gVisor/Firecracker | E2B, Trigger.dev | Validated by n8n CVEs |

---

**End of Document**
