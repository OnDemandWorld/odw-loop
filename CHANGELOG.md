# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Real-time collaborative editing for workflows
- Workflow marketplace for sharing templates
- Natural language workflow generation
- Advanced scheduling with timezone support
- Multi-tenancy support

## [1.1.0-M2] - 2026-07-31

### Added — Frontend Usability & Real-time Monitoring (M2: F4 canvas wiring / F5 WebSocket)
- **Real-time execution events (F5)**
  - `packages/engine/src/eventBus.ts`: a lightweight in-process pub/sub
    (`EventBus`) keyed by `executionId`, with `subscribe`/`unsubscribe`/`clear`,
    a returned unsubscribe fn, and best-effort delivery (a throwing listener is
    isolated). A process-wide `executionEventBus` singleton is exported.
  - The executor publishes node/execution status transitions
    (`node_started`/`node_succeeded`/`node_failed`/`node_skipped`,
    `execution_started`/`execution_succeeded`/`execution_failed`) to the bus.
    Publishing is best-effort and does not change execution behaviour.
  - `GET /ws/executions/:id` (Fastify + `@fastify/websocket`): subscribes the
    client to the bus for one execution and forwards each event as JSON, sends a
    best-effort initial `snapshot`, and tears the subscription down on
    disconnect. Auth mirrors the REST API — enforced only when
    `LOOP_REQUIRE_AUTH` is set, via `?token=`, `Authorization: Bearer`, or
    `x-api-key` (rejected with WS close code `4401` otherwise).

- **Canvas wiring (F4)**
  - `apps/canvas/src/api/client.ts`: a typed fetch wrapper with a configurable
    base URL and `Authorization: Bearer <token>` header, plus the WebSocket
    helpers (`buildExecutionWsUrl`, `openExecutionSocket`) used by the monitor.
  - `apps/canvas/src/store/`: Zustand stores — `useWorkflowStore`
    (list/create/archive) and `useExecutionStore` (current execution + nodes,
    with a pure `reduceNodes` that folds WS events into node state).
  - The Workflows list page now sources its data through `useWorkflowStore`;
    the execution detail page (`/executions/:id`) subscribes to the WS stream
    for live node/status updates (REST poll retained as a fallback); the
    reusable `ExecutionMonitor` component is adapted to the real WS contract.
  - Vite dev server proxies `/ws` (with WebSocket upgrade) to the API.

### Changed
- `ExecutionExecutor` constructor accepts an optional trailing `EventBus`
  (defaults to the `executionEventBus` singleton); `server.ts` wires the same
  instance into both the executor and the WS route.
- `apps/api/src/middleware/auth.ts` exports `resolveTokenPrincipal(token, config)`
  for single-token transports (WS upgrade); the existing HTTP guard is unchanged.

### Fixed
- Canvas SPA now type-checks and builds cleanly (`tsc --noEmit && vite build`):
  resolved pre-existing strict-mode (`noUncheckedIndexedAccess`) errors in
  `ui.tsx`, `lib/api.ts`, `Dashboard.tsx`, and `WorkflowEditor.tsx`.

### Compatibility
- Fully backward compatible: with no WS clients connected, EventBus publishing is
  a no-op; the connector adapters' outward contract is unchanged
  (INTEGRATION_CONTRACT.md §4).

### Tests
- Unit: EventBus pub/sub + cleanup, and executor → EventBus fan-out
  (348 unit tests, +11 over M1).
- Integration: WS endpoint pushes live node-status events and enforces the auth
  gate (120 integration tests, +4 over M1). E2E unchanged (29).

## [1.1.0-M1] - 2026-07-31

### Added — Execution Reliability (M1: F1 durable recovery / F2 idempotency / F3 timeout hardening)
- **Durable recovery (F1)**
  - Append-only `execution_events` table records execution/node lifecycle events
    (`execution_started`, `node_started`, `node_succeeded`, `node_failed`,
    `node_skipped`, `execution_succeeded`, `execution_failed`, `execution_recovered`).
  - On resume, the executor reloads already-`succeeded` node outputs and **skips**
    those nodes instead of re-dispatching them — a recovered execution continues
    from the last successful node with no duplicate side effects.
  - `ExecutionRecovery` appends an `execution_recovered` event when it resets an
    interrupted execution to `pending`.
  - Best-effort `EventLog` (`recordEvent`): an event-write failure logs a warning
    and never breaks execution.

- **Idempotency (F2)**
  - `node_executions.idempotency_key` column (unique index; `${execution_id}:${node_id}`).
  - The executor persists the key and reuses a succeeded node's cached output for
    the same key (shares the resume path); interrupted/failed rows for a key are
    reused rather than duplicated.
  - `ExecuteParams.idempotencyKey` (optional, backward compatible); Vault/Desk/Recap
    connectors forward it best-effort as an `Idempotency-Key` header. The outward
    request/response contract is unchanged (INTEGRATION_CONTRACT.md §4).

- **Workflow-level timeout (F3)**
  - The whole `execute()` run is bounded by an `AbortController` timeout that aborts
    in-flight nodes and marks the execution `failed` with reason `workflow_timeout`.
  - Configurable via `definition.settings.workflow_timeout_ms`, then
    `LOOP_WORKFLOW_TIMEOUT_MS` (new config key), default `300000` ms. The V1.0
    node-level timeout is preserved.

### Changed
- `StateStore` gains `events.append` / `events.listByExecution` and
  `nodeExecutions.findByIdempotencyKey`; `nodeExecutions.create` accepts an optional
  `idempotency_key`. Implemented fully for SQLite; PostgreSQL implements the new
  event methods (no `not implemented` throws for M1 paths).
- Migration `002` (SQLite + PostgreSQL) adds the new table/column idempotently.

### Compatibility
- Fully backward compatible: with no events, no idempotency key, and no workflow
  timeout configured, behaviour equals V1.0.

## [1.0.0] - 2026-06-24

### Added
- **Core Infrastructure**
  - TypeScript monorepo with pnpm workspaces
  - Fastify HTTP/WebSocket server
  - React Flow canvas for visual workflow building
  - SQLite database with Drizzle ORM
  - Pino structured logging
  - Prometheus metrics (15 core metrics)

- **Execution Engine**
  - DAG-based execution with topological scheduling
  - Execution state machine with valid transitions
  - Retry logic with exponential/linear/fixed backoff
  - Circuit breaker pattern for external services
  - Control flow nodes (branch, loop, parallel, approval, delay)
  - Variable interpolation engine
  - Execution recovery on startup

- **Connectors**
  - ODW Vault connector (documents, search, RAG)
  - ODW Desk connector (tasks, projects, calendar)
  - ODW Recap connector (transcripts, action items)
  - Generic REST connector
  - Connector registry with capability discovery
  - Health check monitoring

- **LLM Integration**
  - 7 LLM providers (Ollama, vLLM, OpenAI, Anthropic, Azure, Bedrock, Vertex)
  - Automatic failover with circuit breaker
  - Provider abstraction layer
  - Prompt template engine

- **Triggers**
  - Webhook triggers with HMAC-SHA256 verification
  - Cron triggers with timezone support
  - Event triggers for ODW agent events
  - Manual triggers via API
  - Rate limiting (60 events/min)

- **Security**
  - AES-256-GCM encryption with HKDF key derivation
  - Secrets manager with scope-based access
  - Egress policy engine (domain/IP/region matching)
  - RBAC middleware (read/write/admin roles)
  - JWT authentication with refresh tokens
  - Audit logging for all state changes
  - Code execution sandbox (gVisor/Firecracker stub)

- **Frontend**
  - React 18 application with React Flow canvas
  - Custom nodes (ConnectorNode, ControlNode, CodeNode)
  - Custom edges with bezier paths
  - Node library with search and filtering
  - Node config panel
  - Execution monitor with WebSocket updates
  - Tailwind CSS styling

- **Deployment**
  - Docker images for Core tier
  - Docker Compose configuration
  - Helm chart for Scale tier (Kubernetes)
  - GitHub Actions CI/CD pipeline
  - Environment configuration with Zod validation

- **Testing**
  - 162 unit tests (16 files)
  - 55 integration tests (8 files)
  - 27 E2E tests (6 files)
  - Total: 244 tests, 100% passing
  - Vitest test framework
  - In-memory SQLite for tests

- **Documentation**
  - Comprehensive README with API docs
  - DEVELOPMENT.md with status and decisions
  - CONTRIBUTING.md for contributors
  - AGENTS.md for AI-assisted development
  - Technical specifications (PRD, TSD, TBK, SAD)
  - Architecture diagrams
  - Code examples

### Technical Details

**Backend Stack:**
- TypeScript 5.4
- Node.js 20+
- Fastify 4
- Drizzle ORM 0.29
- Pino 8
- Jose 5 (JWT)
- Zod 3.22

**Frontend Stack:**
- React 18
- React Flow 11
- Tailwind CSS 3
- Vite 5
- Zustand 4

**Database:**
- SQLite (Core tier)
- PostgreSQL (Scale tier)
- JSONB support for complex data

**Infrastructure:**
- Docker + Docker Compose
- Kubernetes + Helm
- GitHub Actions
- Prometheus metrics

### Performance
- Trigger to first node: < 500ms (p95)
- Engine overhead per node: < 50ms (p95)
- Canvas interaction: < 100ms (p95)
- API response time: < 200ms (p95)
- Cold start: < 10s

### Security
- All data encrypted at rest (AES-256-GCM)
- Parameterized queries (no SQL injection)
- Input validation with Zod schemas
- Webhook signature verification (HMAC-SHA256)
- Egress policies enforced by default
- Audit trail for all operations
- RBAC with permission matrix

### Known Limitations
- Code sandbox is a stub (requires gVisor/Firecracker setup)
- RBAC middleware not fully wired into HTTP layer
- Air-gap mode enforcement not fully implemented
- Egress interceptor not integrated into connector execution path
- Execution recovery counts but doesn't re-queue

### Migration Guide
This is the initial release. No migration needed.

## [0.1.0] - 2026-06-20

### Added
- Initial project setup
- Specification documents (PRD, TSD, TBK, SAD)
- Competitive landscape research
- Reference repository analysis
- GitHub repository creation

---

## Version History Legend

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** in case of vulnerabilities

## Release Process

1. Update CHANGELOG.md with changes
2. Bump version in package.json files
3. Create git tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. GitHub Actions builds and publishes Docker images
6. Create GitHub release with changelog
7. Update documentation if needed

## Breaking Changes

### How to Handle
1. Document in CHANGELOG.md under "Breaking Changes"
2. Provide migration guide
3. Bump major version (semver)
4. Update DEPRECATED.md if applicable

### Current Breaking Changes
None (initial release)

## Deprecation Policy

- Features are deprecated for at least 2 minor versions before removal
- Deprecation warnings logged at runtime
- Migration guide provided
- Documented in DEPRECATED.md

## Support

- **Issues:** [GitHub Issues](https://github.com/OnDemandWorld/odw-loop/issues)
- **Discussions:** [GitHub Discussions](https://github.com/OnDemandWorld/odw-loop/discussions)
- **Security:** Email security@odw.ai for security issues

---

**Last Updated:** 2026-06-24
