# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — 组合测试发现（2026-09-12 第二批）
- **Desk 适配器 takeover/resolve 参数通道错位**：`agent_id` 放 JSON body 而 Desk API 读
  Query 参数 → Loop→Desk 人工接管编排恒 422。改为 query 传递（与 send_response 一致），
  接受 `id`/`conversation_id` 双字段名；+2 适配器契约单测、旧集成测试改为断言正确契约。
- **未知节点类型静默空跑**：执行器对未注册适配器"passing input as output"，拼写错误的节点
  （如 `vaultt.search`）创建成功且执行"绿色成功"但什么都没做。创建/模板实例化路由新增
  fail-fast 校验（400 VALIDATION_TOPOLOGY；`stub.*`/`control.*` 显式直通）。
- 测试 app（buildTestApp）适配器集与生产对齐（recap/generic/llm）。

### Fixed — cross-product observability & robustness (review round 3)
- **`/ready` 真实探测**（F-06）：此前 `checks.connectors` 硬编码 `'ok'`，跨产品断链被绿灯
  掩盖。现在 `GET /ready` 并行探测已注册 connector 实例（2.5s 预算），按实例上报
  `vault-default/desk-default/recap-default: ok|unreachable`，汇总 degraded。
- **探测使用实例 base_url**（registry）：`healthCheckAll()` 现把实例配置的 `base_url`
  传给 adapter（此前恒用 adapter 默认值，实例配置被忽略），并带超时预算防挂死。
- **Recap 非 JSON 响应不再静默污染**（F-04）：Recap adapter 收到 HTML 等 非 JSON 体
  （典型场景：`LOOP_RECAP_URL` 指向被占用的 8080 端口上的无关应用）现抛
  `UPSTREAM_RECAP_BAD_RESPONSE`，此前会包装成 `{ text }` 当作成功数据进入工作流输出。
- **默认 URL 静默回退可见**：`LOOP_*_URL` 未设置时启动打 WARN（连接器回退 adapter 默认
  localhost URL）。
- 新增单测：registry base_url 透传/超时熔断、recap 非 JSON 抛错（unit 623）。
- **webhook 签名按原始字节校验真正生效**（bug 11 修复的残留缺口，浏览器级 UAT 发现）：
  Fastify v4 的 content-type parser 第一参数是请求包装对象而非 `request.raw`，rawBody
  挂载点错误导致路由静默回退到重序列化 JSON——所有非规范 JSON（多余空格/键序差异）的
  合法签名被 401 拒绝。现抽为共享 `apps/api/src/raw-body.ts`（server 与集成测试同源），
  挂载到 `req.raw`；新增带空格 JSON 体的原始字节回归测试（unit 623 / integration 157）。


### AI integration wired end-to-end + mainstream vendor support
- **The LLM layer is now reachable.** `@loop/llm` (7 providers, circuit-broken
  fallback router) existed but nothing used it — no endpoint, no node type,
  and the `LOOP_LLM_*` env vars were inert. Now:
  - New workflow node type **`llm.complete`** (`@loop/connectors`
    `LlmConnectorAdapter`): nodes take `prompt`/`system`/`messages` plus
    optional `provider`/`model`/`temperature`/`max_tokens`, resolve
    `{{trigger.payload.*}}` / `{{node_X.output.*}}` upstream data, and emit
    `{ content, model, usage, finish_reason }`. Vendor keys stay server-side —
    workflow definitions never contain credentials.
  - New API endpoints: `POST /api/v1/llm/complete` (single completion with
    provider/model override) and `GET /api/v1/llm/providers` (configured
    vendors, default models, circuit state).
- **Mainstream vendor coverage** via a universal OpenAI-compatible client +
  a vendor preset table: OpenAI, DeepSeek, Qwen/DashScope (compatible mode),
  Moonshot Kimi, Zhipu GLM, SiliconFlow, Groq, Mistral, Together, xAI — plus
  native clients for **Google Gemini** (`generateContent`) and **Anthropic
  Messages**, Azure OpenAI (deployments), and local servers **Ollama** (native
  chat/embed), **vLLM** and **LM Studio** (URL-gated). Any other
  OpenAI-compatible endpoint can be added via the
  `LOOP_LLM_EXTRA_PROVIDERS` JSON env. New guide: `docs/AI接入指南.md`.
- **Router upgrades**: per-vendor default models (requests without a model
  resolve automatically), explicit errors for unknown provider names (no
  silent vendor switching), embed passthrough, and a status listing endpoint.
- **Provider hardening**: every provider now checks HTTP status (a 401 used
  to silently produce an empty completion), drains error bodies, threads the
  egress gate and timeout signal (airgap mode also constrains AI calls), and
  applies a configurable HTTP timeout. Bedrock/Vertex stubs report
  unavailable (they used to claim availability and return empty text).

### Security & reliability hardening (full-project review)

**Critical**
- **Egress policies are now actually enforced (SSRF closed).** The whole
  egress stack (`EgressEngine`, `EgressInterceptor`, `LOOP_AIRGAP_MODE`) was
  dead code — every connector called out with zero checks, so any workflow
  could reach arbitrary hosts (intranet, cloud metadata). A new `EgressGate`
  is wired into the executor and every adapter (`vault`, `desk`, `recap`,
  `generic`): airgap mode blocks all outbound calls, configured policies
  evaluate default-deny, and the no-policies case is governed by the new
  `LOOP_EGRESS_UNCONFIGURED_POLICY` (default `allow` so fresh installs keep
  working).
- **Async DNS in egress resolution.** `resolveIP` fired the callback-based
  `dns.lookup` but returned before it ran — IP-range/region policies could
  never match. Now `await`ed, with a pinned-IP result fed to policy checks.
- **Production refuses publicly known default keys.** With
  `LOOP_ENV=production`, boot now exits if `LOOP_ENCRYPTION_KEY` (or
  `LOOP_JWT_SECRET` while auth is on) is still the public dev default;
  docker-compose no longer ships `:-` fallbacks for them. Auth-disabled
  production prints a loud warning.
- **Workflow timeout no longer crashes or leaks work.** The pre-aborted
  `withTimeout` path could raise an unhandledRejection (process exit), and
  in-flight connector calls kept running after the deadline. Timed-out nodes
  now abort their own `AbortController`, the signal reaches every adapter
  (undici `signal`), later batches stop scheduling, and retries stop on abort.
- **Branch conditions no longer eval JavaScript.** `BranchNode` compiled
  condition strings with `new Function` (RCE-by-workflow-author). Replaced
  with a restricted parser (comparisons, `&&`/`||`/`!`, literals) that fails
  closed; unresolved references never satisfy comparisons.

**Fixed**
- Executions/nodes no longer lose `started_at`/`duration_ms` on terminal
  transitions (`updateStatus` is preserve-on-omit in SQLite and Postgres).
- `executions.completeIfActive`: guarded terminal transition — an API cancel
  can no longer be overwritten by a late executor completion (and vice versa);
  the cancel route, cron/webhook/manual dispatch error paths and the executor
  all use the guard; executor checks cancellation between levels.
- Workflow hard-delete cascades through `execution_events` (previously a
  FOREIGN KEY failure once a workflow had run) and matches node_executions by
  the workflow's actual execution ids; whole cascade is transactional.
- Runtime-created cron triggers are scheduled immediately (previously they
  only worked after a restart) and validated (workflow exists, cron expression
  parses — bad input is a 400, and the create rolls back); a polluted trigger
  row no longer blocks server startup. New `DELETE /api/v1/triggers/:id`.
- Manual/webhook/event/sub-workflow executions snapshot the workflow's current
  `workflow_version` (hardcoded 1 replayed stale definitions).
- Inline sub-workflow definitions are structurally validated before execution
  (dangling edges/duplicate ids used to be silently dropped by the scheduler).
- Domain wildcards in egress policies match at label boundaries
  (`*.example.com` no longer matches `evilexample.com`).
- `LOOP_DB_TYPE=postgres` is honoured by the server (the Postgres store was
  unreachable; deployments silently ran SQLite). Postgres SSL now verifies
  certificates. Migrations run in a transaction each (half-applied state no
  longer bricked startup).
- API keys compare in constant time (hash + `timingSafeEqual`); the spoofable
  `x-user-id` attribution fallback is removed; `/metrics` requires auth when
  auth is enabled; connectors drain upstream error bodies so sockets return to
  the pool; CORS no longer advertises credentials.
- Trigger creation validates `trigger_type`/`config`; pagination params are
  clamped (`?page=abc` no longer 500s); LIKE searches escape `%`/`_`;
  webhook rate-limit buckets are cleaned up; concurrent replays of the same
  execution return 409 instead of double-firing side effects.
- New admin secrets API (`POST/GET/DELETE /api/v1/secrets`) — the encrypted
  store previously had no API surface at all.

### Added
- **Templates marketplace & simplified creation.** Loop now ships an
  industry-level template platform (inspired by Zapier's creation wizard,
  n8n's template gallery / searchable palette and Dify/Coze marketplaces):
  - `@loop/templates` package (`packages/templates`): registry that loads and
    schema-validates `templates/*.json`, derives industry/category/icon from a
    12-industry taxonomy when envelopes omit them, featured-first sorting,
    and `instantiate()` with deep-copy isolation + name/description overrides.
  - 9 new industry templates (23 total across 12 industries): invoice
    approval, abandoned-cart recovery, contract renewal tracking, patient
    intake summary, weekly campaign digest, support ticket triage, equipment
    maintenance alerts, payment reconciliation alerts, course feedback
    analysis — plus the 5 featured starters.
  - API: `GET /api/v1/templates` (industry/category/featured/search filters
    + facet vocabularies in meta), `GET /api/v1/templates/:id` (full
    definition), `POST /api/v1/templates/:id/instantiate` (201 draft workflow
    tagged `template:<id>` provenance).
  - Canvas `/templates` marketplace page: industry chips, search, featured
    toggle, detail modal with node/agent breakdown, one-click "Use template".
  - Simplified creation flow: two-step "New workflow" wizard (blank canvas /
    featured quick-picks / browse-all link, prefilled name+description+tags),
    searchable node palette ("Search nodes…", empty state), and a form-based
    node config panel with Form/JSON toggle and `{{node_id.output.field}}`
    syntax hints.
  - Tests: 12 unit cases (`tests/unit/templates/registry.test.ts`) + 10
    integration cases (`tests/integration/api/templates.test.ts`).

### Fixed
- **Execution recovery now actually re-dispatches (bug 12).** `findInterrupted()`
  selects both `running` and `pending` executions in the SQLite and PostgreSQL
  stores (previously `pending` records were invisible and stayed stuck forever).
  `ExecutionRecovery` accepts an injected `RecoveryDispatcher`; recovered
  executions are re-dispatched to the executor instead of merely being reset to
  `pending` with nothing to pick them up. Running executions with zero completed
  nodes still settle to `failed` (ambiguous in-flight side effects); dispatch
  failures (e.g. archived workflow) settle to `failed` with the reason.
- **Webhook triggers now run the workflow (bug 13).** `POST /webhooks/:triggerId`
  previously persisted only a `pending` execution record and never invoked the
  executor, so webhook-triggered workflows never ran. The route now dispatches
  asynchronously, mirroring the manual `/execute` route; the handler also returns
  `workflow_id`. Verified end-to-end: signed webhook → execution reaches a
  terminal state.
- **Cron triggers now run the workflow (bug 14).** `CronTriggerHandler` accepts an
  optional dispatcher; each fired tick executes the created execution (and settles
  it to `failed` with a reason if dispatch cannot start) instead of leaving a
  permanent `pending` record.
- **PostgreSQL store import cleanup.** Removed dead `drizzle-orm` / `schema` /
  `PaginatedResult` imports (queries are raw SQL); clears 10 lint errors.

### Planned
- Real-time collaborative editing for workflows
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
- ~~RBAC middleware not fully wired into HTTP layer~~ **已过时**：RBAC 已在 HTTP 层生效（V1.3 起，role_uat 运行时验证 admin/editor/viewer 403/401 正确）
- Air-gap mode enforcement not fully implemented
- Egress interceptor not integrated into connector execution path
- ~~Execution recovery counts but doesn't re-queue~~ **已修复**（bugs 12-14，见 DEEP_REVIEW_REPORT.md：恢复的执行真正重新分发）

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
