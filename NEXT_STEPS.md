# Loop — 下一步开发规划（NEXT STEPS）

> 生成时间：2026-09-13 · 基于 V1.6 + 全局复审四轮 + LLM 接入完成后的实测状态。
> 当前健康度：**typecheck 0 错误、build 16/16、单元 625 + 集成 169 + E2E 29 = 823 测试全绿**。
> 优先级：P0 = 阻断正确性/安全的真实缺陷，必须尽快；P1 = 高价值功能补全；P2 = 增强/工程化；P3 = 远期/规模层。

---

## 1. 🔴 P0 — 模板 ↔ 连接器操作漂移（ marketplace 一致性）

**现象（实测）**：`templates/*.json` 里大量节点引用了**连接器尚未实现的操作**。`assertKnownNodeTypes` 目前只校验连接器前缀（`desk.*`/`recap.*`），故这些模板可成功实例化，但**一执行就抛 `Unknown Desk/Recap operation`**。本轮已加"能力级告警"暴露问题（`logger.warn`，非致命），但根因需产品决策。

| 模板中用到、但适配器未实现的操作 | 引用次数 |
|---|---|
| `desk.send_notification` | 21 |
| `desk.create_task` | 14 |
| `recap.classify` | 12 |
| `recap.summarize` | 7 |
| `recap.extract_action_items` | 4 |
| `desk.create_calendar_event` | 2 |
| `desk.list_tasks` / `desk.create_project` | 各 1 |

实际已实现：`desk` 仅 `list_conversations / get_conversation / send_response / takeover / resolve`；`recap` 仅 `login / list_meetings / get_meeting / create_meeting / sync`（`INTEGRATION_CONTRACT.md` 的真实 HTTP 契约）。

**两种路线，二选一（或组合）：**
- **A. 扩连接器操作**（推荐，若 Desk/Recap 后端确有这些端点）：按 `INTEGRATION_CONTRACT.md` 核对真实端点后补齐 `desk.create_task`、`recap.summarize` 等；每加一个补适配器契约测试。
- **B. 改模板**：把模板节点改用现有操作或 `llm.complete`（例如 `recap.summarize` → `recap.get_meeting` + `llm.complete` 生成摘要），使 marketplace 立即可跑通。

**验收**：`templates/*.json` 里每个 `node.type` 都能被对应适配器执行成功（新增一个脚本/测试遍历所有模板做 dry-run 校验：加载 → 断言每个节点类型 ∈ 连接器 `getCapabilities().node_types`）。

---

## 2. 🔴 P0 — 无签发凭据的入口（认证闭环缺失）

**现象**：`LOOP_REQUIRE_AUTH=true` 时 `middleware/auth.ts` 能**校验** JWT 与静态 API Key，但**没有任何路由能登录并签发 JWT**（全仓无 `POST /auth/login`、无 `SignJWT` 调用、无密码校验端点）。`bcrypt` 在 devDependencies 里却无人调用；`users` 表有 `password_hash` 但只有 JIT 预置写入空哈希。

**影响**：生产只能靠单一静态 API Key（全体共享、角色固定），RBAC 的 editor/viewer 无法真正区分身份——因为没人能拿到个性化 token。

**开发内容**：
- `POST /api/v1/auth/login`：用户名+密码 → bcrypt 校验 `users.password_hash` → 用 `LOOP_JWT_SECRET` 签发 access/refresh（`jose.SignJWT`，TTL 用已有的 `LOOP_JWT_ACCESS_TTL`/`LOOP_JWT_REFRESH_TTL`）。
- `POST /api/v1/auth/refresh`：refresh → access。
- 登录防爆破：按用户名/ IP 限流（复用 rate-limit 或独立小桶）。
- 用户管理路由（admin）：创建用户（设密码 bcrypt）、改角色、停用——目前 `store.users` 全套 CRUD 已有，缺 HTTP 面。
- 首个管理员引导：`LOOP_BOOTSTRAP_ADMIN_*` env 或首次启动随机密码打印一次。
- 测试：登录/刷新/失败限流/RBAC 端到端。

---

## 3. 🟠 P1 — 代码执行节点未落地（Canvas 有入口、后端无实现）

**现象**：Canvas 节点库提供 `code.typescript` / `code.python`，`WorkflowEditor` 有 `code` 节点渲染；但 `packages/*` 里**没有 code 连接器适配器**，`LOOP_SANDBOX_*` 配置也无人消费。`assertKnownNodeTypes` 因 `code` 前缀非 passThrough 且无适配器，含代码节点的工作流会在创建时 400（比静默失败好，但功能不可用）。

**开发内容**：
- 实现 `code` 连接器适配器，或让 `apps/sandbox` 成为真实执行体（见 §4），二者的 `execute` 通过 sandbox HTTP 调用隔离执行用户代码。
- 语言：优先 TypeScript/JS（Node `vm` 不足以做安全隔离，必须走 sandbox 进程/容器）。
- 输入输出契约：节点 config `source` + `input` → sandbox 运行 → `output`，带内存/CPU/超时/网络出口（复用 `EgressGate`）限制。
- 在 `code` 未就绪前，Canvas 应**隐藏或标注 code 节点为实验性**，避免用户搭了不能跑的流程。

---

## 4. 🟠 P1 — Sandbox / Control-plane 是 stub（安全执行 + 水平扩展的地基）

**现象（实测）**：`apps/sandbox/src/server.ts` 仅 44 行，`/health` 直接返回 `{ status: 'stub' }`，`code.*` 节点、以及 PRD 承诺的"用户自定义代码/LLM 工具在 gVisor/Firecracker 中隔离执行"完全没有实现。`apps/control-plane` 同样是 stub。docker-compose 里 `loop-sandbox` 依赖健康检查会过（因为 /health 恒 ok），但真调用无从执行。

**开发内容**：
- `apps/sandbox`：接收 `{language, code, input, limits}` → 在隔离环境（容器/gVisor，降级到进程级 `child_process` + 严格 rlimit/seccomp 亦可先起步）执行 → 返回 stdout/结果或错误；带 CPU/内存/墙钟/网络四条护栏。
- 与执行器对接：`code.*` 与 `workflow.invoke` 之外的"工具调用"统一走 sandbox。
- 密钥注入：sandbox 只拿本次所需的 secrets，不落盘。
- 控制面（P2）：多 sandbox 池化、调度、指标。
- 安全评审：sandbox 是新的 RCE 攻击面，须过 AGENTS.md 安全检查清单（egress、secrets、资源上限、日志脱敏）。

---

## 5. 🟠 P1 — AI 能力深化（在已接通的多厂商之上）

本轮已完成：多厂商路由 + 熔断回退 + `llm.complete` 节点 + `/api/v1/llm/*` + egress 一致管控 + 类型化表单。下一步：
- **流式输出**：`CompletionRequest.stream` 已在接口里但 provider 全部 `stream:false`。接 `POST /api/v1/llm/complete` 的 SSE 变体 + WebSocket 通道，供前端打字机式呈现（LLM 长回复体验关键）。
- **工具/函数调用**：`llm.complete` 目前只回文本。加 `tools`/`function_calling` 透传（OpenAI/Anthropic/Gemini 三家格式不同，需归一化到 `@loop/llm` 抽象）。
- **结构化输出**：`response_format: json` + schema 校验（Zod），失败自动重试一次。
- **成本与用量**：`usage` 已有但只做单次返回。落 `execution_events` 聚合成本指标（Prometheus：每厂商/每工作流 token 花费），前端展示。
- **Embedding 路径打通**：`router.embed` 已实现（Ollama），但没有调用方；与 Vault RAG 联动做本地向量化选项。
- **提示词模板 + 版本**：把常用 system/prompt 片段做成可复用资产（与模板库并列）。
- **单测补真实执行链路**：目前 llm 端到端只到 spy/mock，缺一条"workflow → executor → llm.complete（mock provider）→ 断言 content 落到下游节点"的集成用例。

---

## 6. 🟡 P2 — 触发器/调度完整性

- **事件触发器安全**：本轮加了 `POST /api/v1/events`，但它无鉴权（同 webhook 应有 HMAC 或来源校验）。补共享密钥/签名校验。
- **分布式调度**：当前 cron 调度在**每个 API 进程内**（node-cron）。多副本部署会重复触发。Scale 层需 Redis/DB 租约选主（见 §8），或单调度器进程。
- **触发器 UI**：Canvas 目前没有触发器管理界面（cron 表达式/时区/webhook 密钥），只能走 API。本轮已补全后端 CRUD + 启停，缺前端表单。
- **时区**：cron `timezone` 参数已透传，但无 UI/校验，且需确认服务器 TZ 数据完整。

---

## 7. 🟡 P2 — 可观测与运维

- **OTel 真实导出**：`LOOP_OTEL_*` 配置存在，`packages/observability` 的 tracing 目前是自研 span + console exporter（本轮 review 见 `loop:tracing:exporter` 直接打日志）。接真正的 OTLP exporter，导出到 Collector/Jaeger。
- **`/ready` 深化**：本轮已让 /ready 真实探测连接器健康；补 DB 连接探测、Redis、sandbox 池状态。
- **指标看板**：15+ 指标已埋点，缺一份 Grafana dashboard JSON 随仓库交付。
- **审计导出**：`/api/v1/audit` 已 admin 保护；补导出（SIEM webhook / 定期归档）。
- **/metrics 已纳入认证**（本轮），文档补充 Prometheus 抓取配 token 的示例。

---

## 8. 🟢 P3 — Scale 层（Postgres + Redis + 多副本）

本轮已让 `LOOP_DB_TYPE=postgres` 真正可用、Postgres SSL 校验证书、迁移补齐。剩余：
- **Redis 队列**：`LOOP_REDIS_URL` 全仓仅 config 引用，无实现。把执行派发从"进程内 fire-and-forget"改为队列（BullMQ/自建），支持多 worker 横向扩展、重试、限流。
- **迁移到 PG 的完整性回归**：PG 适配器已实现但测试多用 mock；补一条 docker-compose PG 的集成回归（真实 round-trip，尤其本轮新增的 `completeIfActive`/级联删除/事件在 PG 路径的一致性）。
- **事件溯源保留策略**：`execution_events` 只增，需归档/TTL 压缩策略（快照 + 截断）。
- **多租户**：`workflows`/`executions` 无 tenant 维度，SaaS 化前需加 `tenant_id` + 行级隔离。

---

## 9. 🟢 P3 — 前端（Canvas）体验

- 触发器管理面板（cron 表达式构建器 + 时区 + webhook URL 复制/密钥轮换）。
- `llm.complete` 节点实时"试跑"按钮（调用 `/api/v1/llm/complete` 预览输出）。
- 执行详情：并行层级甘特/时间线可视化（事件日志已含时序数据）。
- 模板 marketplace：分类分页/收藏/最近使用。
- E2E：Playwright 浏览器级冒烟（当前 e2e 是 API 级 inject，无真实点击链路覆盖）。

---

## 10. 建议执行顺序（一个迭代 = 1–2 周）

| 迭代 | 主题 | 含条目 |
|------|------|--------|
| Sprint 1 | Marketplace 正确性 + 认证闭环 | §1、§2 |
| Sprint 2 | 代码执行 + Sandbox | §3、§4 |
| Sprint 3 | AI 深化（流式/工具/成本） | §5 |
| Sprint 4 | 触发器完整性 + 前端面板 | §6、§9 |
| Sprint 5 | 可观测 + Scale 层地基 | §7、§8 |

---

## 附：本轮（第四轮复审）已修复项速览

egress 一致管控（补 LLM 直连 API 旁路）、未知 provider 400、事件触发器接通、触发器启停、egress/connector 管理 API、update 节点类型校验、约束冲突统一 409、git 路径消毒、connectors↔llm 构建引用、Ollama-only 启动告警、`llm.complete` 进 Canvas、能力级漂移告警。**全部有回归测试覆盖，823 测试通过。**
