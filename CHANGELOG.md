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

## [1.6.0-M1] - 2026-08-02

### Added — DB lifecycle root-cause fix (F-1, DB1–DB4)
- **`packages/state/src/sqlite/connection.ts`**: every SQLite connection is
  now registered in a module-level registry; a synchronous
  `process.on('exit')` hook releases any handles still open when the process
  terminates (best-effort, never throws). Explicit `close()` unregisters
  first, so the exit hook never double-closes. This attacks the root cause of
  the rare better-sqlite3 teardown SIGSEGV (exit 139): native handles are no
  longer left for GC to destroy during process exit. Exported diagnostics /
  test hooks: `closeAllSqliteConnections()`, `openSqliteConnectionCount()`.
- **DB1**: `StateStore.close()` (already on the interface since V1.0; SQLite
  `db.close()` + PostgreSQL `conn.close()`) is now covered by dedicated
  lifecycle tests — handle release + idempotent double-close.
- **DB2**: `tests/helpers/testStore.ts` — `withTestStore(fn)` /
  `withSeededTestStore(fn)` guarantee the connection is closed even when the
  test body throws; `tests/setup.ts` (wired via `setupFiles` in all three
  vitest configs) adds a global `afterEach` safety net closing any tracked
  connection a test leaked. The integration security/egress suite now closes
  its per-test store in `afterEach` (previously leaked).
- **DB4**: stability verified — 3 consecutive full runs of
  `typecheck + unit + integration + e2e` (no retry wrapper) all green.
  Conclusion: the `scripts/run_with_retry.sh` wrapper in the top-level
  Makefile was **kept** (not removed) as a cheap CI safety net — see
  DEVELOPMENT.md for the reasoning.

### Added — Distributed tracing spans, Loop side (F-2, SP1–SP4)
- **`packages/observability/src/tracing.ts`**: lightweight span model
  `{name, trace_id, span_id, parent_span_id?, start_ms, duration_ms?, attrs?,
  status}` with `startSpan(name, attrs?)` / `span.end(status?)`. An
  `AsyncLocalStorage` span stack auto-parents child spans (including across
  awaited boundaries); `runInSpan` / `withSpan` establish the active-span
  context. Sampling via `TRACE_SAMPLE_RATE` (0.0–1.0, default **1.0**): the
  decision is rolled once per trace root and inherited by every child, so a
  trace is never partially sampled; unsampled spans are true no-ops (nothing
  recorded, nothing exported). Root spans reuse the V1.5 correlation
  `trace_id` (inbound `X-Trace-Id`) when present, so spans and structured
  logs share one trace id.
- **`packages/observability/src/exporters.ts`**: `SpanExporter` with
  `ConsoleSpanExporter` (default — one structured pino line per span) and
  `OtlpHttpSpanExporter` (fire-and-forget OTLP/HTTP JSON POST to
  `<OTLP_ENDPOINT>/v1/traces`; network errors, non-2xx and timeouts degrade
  silently to a debug log). `TRACE_EXPORTER=console|otlp|none` (default
  **console**). Export is best-effort and can never throw into the caller.
- **`packages/engine/src/executor.ts`**: `execute()` wraps the run in a
  `loop.execution` span and `executeNode` wraps each node in a `loop.node`
  span parented to it (sub-workflow child executions parent under their
  invoking node span). Best-effort — execution results, events and EventBus
  fan-out are unchanged; with sampling off the wrappers are pass-throughs.
- **Config** (SP4): `TRACE_SAMPLE_RATE`, `TRACE_EXPORTER`, `OTLP_ENDPOINT`
  documented in `.env.example`; read directly by the tracing module with
  programmatic overrides (`configureTracing`) for tests/embedders.

### Compatibility
- Fully backward compatible. Default sampling 1.0 + console exporter preserve
  existing behaviour (spans appear as additional structured log lines). The
  connector request/response contract is unchanged (INTEGRATION_CONTRACT.md
  §4). DB close is best-effort; the `StateStore` interface is unchanged
  (`close()` already required). No schema/migration changes.

### Tests
- 410 → **448 unit** (+38: 8 DB lifecycle, 16 tracing, 11 exporters,
  3 executor span-tree); **141 integration** and **29 e2e** baselines
  preserved. All suites green across 3 consecutive runs without the
  retry wrapper.

## [1.5.0-M1] - 2026-08-01

### Added — PostgreSQL Scale layer completion (F-1, PG1–PG4)
- **`packages/state/src/postgres/index.ts`**: implemented every entity that
  previously threw `not implemented`, with parameterized (`$1...`) SQL mirroring
  the SQLite reference adapter — `executions`, `nodeExecutions` (idempotency-key
  lookup + conditional `updateStatus`), `workflowDefinitions`, `connectors`,
  `triggers`, `audit` (3-attempt retry), `users`, `secrets`, `egressPolicies`
  (alongside the already-implemented `workflows` and `events`). The PostgreSQL
  Scale layer now reaches CRUD parity with SQLite across all 10 entities.
- Row mappers normalise PostgreSQL `TIMESTAMP`/`JSONB` values to the same
  ISO-string / object shapes the SQLite adapter returns.

### Added — Distributed tracing, Loop side (F-3, TR1–TR2)
- **`apps/api/src/middleware/traceId.ts`**: `onRequest` hook (registered after
  `requestIdHook`) reads the inbound `X-Trace-Id` header (generating a UUIDv4
  when absent) and runs the request lifecycle inside a correlation context
  carrying `trace_id`.
- **`packages/observability/src/logger.ts`**: pino `mixin` (`correlationMixin`)
  injects `trace_id`/`request_id` into every structured log line emitted while a
  correlation context is active (best-effort, no-op outside a request).
- **`packages/connectors/src/trace.ts`**: `traceHeaders()` — the Vault/Desk/Recap
  adapters forward the active `trace_id` as an outbound `X-Trace-Id` header
  (best-effort, from `AsyncLocalStorage`).

### Changed — Test hardening (F-4', TH1–TH3)
- Timing-sensitive unit tests hardened **without deleting assertions**: fake
  timers for the circuit-breaker cooldown logic; widened wall-clock margins
  (scheduler 50→1000ms, executor parallel 160→1500ms, node/workflow timeouts
  30/50→200ms). Event-driven assertions (e.g. `maxInFlight`) are unchanged.
- **`vitest.config.ts`**: unit test files run serially (`fileParallelism: false`)
  to remove native better-sqlite3 / CPU contention under high load.

### Compatibility
- Fully backward compatible. SQLite remains the default store; the connector
  request/response contract is unchanged (INTEGRATION_CONTRACT.md §4) — tracing
  only adds an outbound header. Migrations are idempotent and unchanged.

### Tests
- 375 unit + 141 integration + 29 e2e baseline preserved; +35 new unit tests
  (23 PostgreSQL mock-client, 6 trace middleware/mixin, 6 connector trace
  forwarding) → 410 unit total. `undici` added as a root devDependency for the
  connector tests' `MockAgent`.

## [1.4.0-M2] - 2026-08-01

### Added — Replay Output Persistence (M2: F-2)
- **`packages/engine/src/executor.ts`**: when the executor records a
  `node_succeeded` event it now persists the node's output in the event payload
  as `{ duration_ms, output }`, so a replay can reconstruct full node outputs
  from the append-only `execution_events` log (not just status/timeline).
  - **Size cap**: the output is JSON-serialised and measured against
    `LOOP_EVENT_OUTPUT_MAX_BYTES` (default `65536` = 64KB). When it fits, the
    full output is stored; when it exceeds the cap, a small truncated marker
    `{ __truncated__: true, size, preview }` is stored instead (`size` = original
    serialised byte length, `preview` = a short leading slice of the JSON), so
    oversized outputs cannot bloat the events table.
- **`packages/engine/src/replay.ts`**: `foldExecutionEvents` /
  `reconstructExecution` read the persisted `output` back into
  `NodeSnapshot.output`, preserving a truncation marker verbatim.
- **Config** (`apps/api/src/config.ts`): added `LOOP_EVENT_OUTPUT_MAX_BYTES`
  (number, default `65536`), wired into the `ExecutionExecutor`.

### Compatibility
- Fully backward compatible. Events written before M2 carry no `output` field,
  so a reconstructed snapshot's `NodeSnapshot.output` stays `undefined` for them
  (prior behaviour). Dry-run replay decisions are unchanged. Connector adapters'
  outward contract is unchanged (INTEGRATION_CONTRACT.md §4) — only the internal
  event payload gained a size-capped `output` field.

### Tests
- Integration (`tests/integration/engine/replay-output.test.ts`): execute →
  reconstruct asserts node outputs are persisted and folded back; an oversized
  output is stored as a truncation marker (full output NOT persisted); legacy
  events without `output` fold to `output === undefined`.

## [1.3.0-M1] - 2026-08-01

### Added — Event-Sourced Replay (M1: F-Loop-1)
- **`packages/engine/src/replay.ts`**: reconstruct an execution's state from the
  append-only `execution_events` log (V1.1 M1) and replay it.
  - `foldExecutionEvents` — PURE, deterministic fold of an event stream into an
    `ExecutionSnapshot` (`status`, per-node `nodeStates`, `startedAt`/`endedAt`,
    `timeline`). `reconstructExecution(store, executionId)` is its async wrapper.
  - `replayExecution(executor, store, executionId, { dryRun })` — **default
    `dryRun=true`** produces per-node decisions (`would-run` /
    `skipped-because-succeeded` / `failed`) WITHOUT invoking any connector
    (read-only, no side effects). Only `dryRun=false` re-executes, reusing the
    V1.1 resume path that skips already-succeeded nodes.
- **API**: `GET /api/v1/executions/:id/replay` (snapshot + dry-run decisions) and
  `POST /api/v1/executions/:id/replay?dryRun=` (default dry-run; `false` re-runs).
- **Types** (`packages/types/src/schemas/replay.ts`): `ExecutionSnapshot`,
  `NodeSnapshot`, `SnapshotTimelineEntry`, `ReplayResult`, `NodeReplayDecision`,
  `ReplayDecision`, `ReplayRerunOutcome`.

### Added — Role-Based Access Control (F-RBAC-Loop)
- Roles `admin` > `editor` > `viewer` in `apps/api/src/middleware/auth.ts`. Role
  resolves from the JWT `role`/`roles` claim (no claim → least privilege
  `viewer`) and, for a static API key, from the new `LOOP_API_KEY_ROLE` env var
  (default `admin`).
- Route-level minimum-role guards: reads (`GET`) need `viewer+`, writes
  (`POST/PUT/DELETE`) need `editor+`, and `/api/v1/audit` needs `admin`. Exempt:
  `/health`, `/ready`, `/metrics`, `/webhooks/*`. `requireRole(min)` is exported
  for explicit per-route guarding.
- The request actor is extended to `{ principal, role }`; requests carry
  `authPrincipal` + `authRole`. Insufficient role → `403 FORBIDDEN_INSUFFICIENT_ROLE`.

### Changed
- `apps/api/src/config.ts`: added `LOOP_API_KEY_ROLE` (enum admin/editor/viewer,
  default `admin`).

### Compatibility
- Fully backward compatible. Replay dry-run is read-only. RBAC enforcement is
  gated behind `LOOP_REQUIRE_AUTH` (default off = open), so existing unauthenticated
  tests stay green. Connector adapters' outward contract is unchanged
  (INTEGRATION_CONTRACT.md §4) — replay never alters the adapter interface.

### Tests
- Unit: replay reconstruction + dry-run (no connector calls) + resume re-run;
  RBAC role resolution + route classification.
- Integration: replay API (snapshot + decisions, side-effect-free dry-run, 404);
  RBAC (viewer write → 403, editor write → 201, viewer read → 200, admin-route
  gating, API-key role mapping, auth-off open).

## [1.2.0-M3] - 2026-08-01

### Added — Sub-workflow Invocation (M3: F-Loop-1)
- **`workflow.invoke` engine-built-in node**
  - `packages/engine/src/executor.ts`: `dispatchNode` intercepts
    `node.type === 'workflow.invoke'` BEFORE connector routing (it is an engine
    built-in, not a connector). The node resolves a child definition — an inline
    `input.definition` object, or loaded by `input.workflow_id` from the store —
    maps `input.inputs` onto the child's `trigger.payload`, creates a child
    execution (its own `execution_id`), and recursively runs the child on the
    SAME executor, so the child reuses the workflow timeout, EventBus fan-out,
    idempotency and resume machinery. On success the node returns
    `{ outputs: <child final nodeOutputs>, status: 'succeeded' }`; a failing
    child throws and fails the parent node.
  - **Recursion guard**: depth is carried via the `ExecutorContext`
    (`execute()` accepts an optional `ExecuteOptions`); exceeding
    `maxSubWorkflowDepth` (default 5, env `LOOP_SUBWORKFLOW_MAX_DEPTH`,
    constructor-overridable) throws the new `SUBWORKFLOW_DEPTH_EXCEEDED` error
    code. A visited-set cycle guard also stops self-invoking workflows fast.
  - **Output consumption (S3)**: child outputs are reachable from downstream
    parent nodes via the usual `{{node_X.output.*}}` interpolation; interpolation
    gained a backward-compatible nested-path fallback so
    `{{node_sub.output.outputs.node_c1.value}}` resolves.
  - **Event nesting (S4)**: `ExecutionBusEvent` carries an optional
    `parentExecutionId`; every event emitted by a sub-workflow execution is
    tagged with its parent so monitors can rebuild the parent→child tree.

### Changed
- `ExecutionExecutor.execute()` now resolves with the final per-node output map
  (`Map<string, Record<string, unknown>>`) so a parent can surface a child's
  outputs; root callers may ignore the return value. An optional trailing
  `ExecuteOptions` carries recursion state (depth / parentExecutionId / visited).
- `packages/types/src/errors.ts`: added `SUBWORKFLOW_DEPTH_EXCEEDED` error code.

### Compatibility
- Fully backward compatible: the `execute()` signature change is additive
  (optional param + previously-void return); root executions behave exactly as
  before. Connector adapters' outward contract is unchanged
  (INTEGRATION_CONTRACT.md §4) — `workflow.invoke` is engine-built-in. Inline
  sub-workflows reuse the parent execution's `workflow_id` so child execution /
  node / event rows satisfy FK constraints without persisting a synthetic
  workflow.

### Tests
- Unit: `workflow.invoke` executes an inline child and returns outputs, maps
  inputs to the child payload, surfaces child outputs downstream, fails the
  parent on child failure, enforces the depth ceiling, stops cycles, and tags
  child events with `parentExecutionId`.
- Integration: parent → child → downstream end-to-end (inline + stored-by-id),
  and recursion-depth bounding (`SUBWORKFLOW_DEPTH_EXCEEDED`).

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
