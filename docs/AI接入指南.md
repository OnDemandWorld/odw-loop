# Loop AI 接入指南

本指南说明 Loop 如何接入 AI 能力工作，以及如何配置主流 AI 厂商接口与本地部署的模型服务。

---

## 一、AI 在 Loop 中如何工作（架构总览）

```
工作流节点 llm.complete ──┐
                          │
API POST /api/v1/llm/complete ──► LLMRouter（熔断 + 回退链）
                          │              │
                          │   ┌──────────┼──────────┬──────────┐
                          │   ▼          ▼          ▼          ▼
                          │ Ollama    OpenAI     Anthropic   Gemini
                          │ (本地)    兼容客户端  原生API    原生API
                          │            │
                          │            ├─ DeepSeek / Qwen(通义) / Kimi(月之暗面)
                          │            ├─ 智谱GLM / 硅基流动 / Groq / Mistral
                          │            ├─ Together / xAI(Grok)
                          │            └─ vLLM / LM Studio / 任意兼容端点
                          ▼
                   EgressGate 出口管控（airgap / 白名单同样约束 AI 调用）
```

**要点：**

1. **统一抽象**：所有厂商实现同一个 `LLMProvider` 接口（`packages/llm/src/interface.ts`），返回统一的 `{ content, model, usage, finish_reason }`。
2. **熔断与回退**：`LLMRouter` 按配置的厂商顺序逐个尝试；某厂商连续失败 5 次后熔断 30 秒，期间自动跳过。一个厂商宕机，业务不断。
3. **按厂商默认模型**：请求未指定 `model` 时，自动使用该厂商的默认模型（如 DeepSeek → `deepseek-chat`、Qwen → `qwen-plus`）。
4. **密钥永不进工作流**：所有 API Key 存在服务端环境变量；工作流定义里只引用厂商名/模型名。前端与导出的工作流 JSON 中不含任何凭据。
5. **同样的安全管控**：AI 的出站请求与连接器一样经过 `EgressGate`（airgap 模式下全部拦截），并受节点/工作流超时 signal 约束（超时立即中断 HTTP 请求）。

---

## 二、支持哪些厂商/部署方式？

| 类别 | 厂商 | 接入协议 | 启用条件 | 默认模型 |
|------|------|----------|----------|----------|
| **本地** | Ollama | 原生 `/api/chat`、`/api/embed` | 永远注册（默认 `localhost:11434`） | — |
| **本地** | vLLM | OpenAI 兼容 | 显式设置 `LOOP_LLM_VLLM_URL` | `local-model` |
| **本地** | LM Studio | OpenAI 兼容 | 显式设置 `LOOP_LLM_LMSTUDIO_URL` | `local-model` |
| **云** | OpenAI | OpenAI 兼容 | 配置 Key | `gpt-4o-mini` |
| **云** | Anthropic Claude | 原生 Messages API | 配置 Key | `claude-3-5-haiku-latest` |
| **云** | Google Gemini | 原生 generateContent | 配置 Key | `gemini-2.0-flash` |
| **云** | Azure OpenAI | 部署式 API | 配置 Endpoint + Key | — |
| **云** | DeepSeek 深度求索 | OpenAI 兼容 | 配置 Key | `deepseek-chat` |
| **云** | 阿里云百炼 Qwen | DashScope 兼容模式 | 配置 Key | `qwen-plus` |
| **云** | Moonshot Kimi | OpenAI 兼容 | 配置 Key | `moonshot-v1-8k` |
| **云** | 智谱 GLM | OpenAI 兼容 | 配置 Key | `glm-4-flash` |
| **云** | 硅基流动 SiliconFlow | OpenAI 兼容 | 配置 Key | `deepseek-ai/DeepSeek-V3` |
| **云** | Groq | OpenAI 兼容 | 配置 Key | `llama-3.3-70b-versatile` |
| **云** | Mistral | OpenAI 兼容 | 配置 Key | `mistral-large-latest` |
| **云** | Together AI | OpenAI 兼容 | 配置 Key | `meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| **云** | xAI Grok | OpenAI 兼容 | 配置 Key | `grok-2-latest` |
| **任意** | 自建网关/私有化厂商 | OpenAI 兼容 | `LOOP_LLM_EXTRA_PROVIDERS` JSON | 自定义 |

> **原理**：市场上绝大多数服务都提供 OpenAI 兼容的 `/chat/completions` 端点，所以"OpenAI 兼容客户端 + 厂商预设表（`packages/llm/src/presets.ts`）"即可覆盖绝大多数厂商。Anthropic 与 Gemini 提供原生客户端（支持各自特有字段）。新增厂商 = 预设表加一行。

---

## 三、配置方法（环境变量）

### 3.1 最小可用配置（本地 Ollama，零成本起步）

```bash
LOOP_LLM_PRIMARY=ollama
LOOP_LLM_OLLAMA_URL=http://localhost:11434
LOOP_LLM_FALLBACK_CHAIN=ollama
```

本机装好 Ollama 并 `ollama pull llama3.1` 后即可使用（Ollama 始终注册，无需 Key）。

### 3.2 云厂商混合 + 回退（推荐生产配置）

```bash
# 主力：DeepSeek（便宜）；失败回退 Qwen，再回退本地 Ollama
LOOP_LLM_PRIMARY=deepseek
LOOP_LLM_FALLBACK_CHAIN=deepseek,qwen,ollama
LOOP_LLM_DEEPSEEK_KEY=sk-...
LOOP_LLM_QWEN_KEY=sk-...
LOOP_LLM_OLLAMA_URL=http://ollama.internal:11434
```

### 3.3 覆盖默认模型 / 自定义端点

```bash
LOOP_LLM_DEEPSEEK_MODEL=deepseek-reasoner        # 覆盖默认模型
LOOP_LLM_QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LOOP_LLM_OPENAI_BASE_URL=https://your-proxy.example.com/v1   # 走代理
```

### 3.4 任意其他 OpenAI 兼容端点（私有化部署/网关）

```bash
LOOP_LLM_EXTRA_PROVIDERS='[{"name":"corporate","base_url":"https://llm.corp.internal/v1","api_key":"k1","model":"qwen2.5-72b"}]'
```

之后即可在工作流里用 `provider: "corporate"` 引用。名字会出现在 `GET /api/v1/llm/providers`。

### 3.5 全部变量

见 [.env.example](../.env.example) 的 `LLM Providers` 段（每家厂商均为 `LOOP_LLM_<名字>_KEY / _MODEL / _BASE_URL` 三件套，Key 缺省即不注册该厂商）。

---

## 四、如何在业务里使用 AI

### 4.1 工作流节点（自动化场景）

在画布/工作流定义中加入 **`llm.complete`** 类型节点：

```json
{
  "id": "node_summarize",
  "type": "llm.complete",
  "config": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "system": "你是客服质检助手，输出通过/不通过和理由。",
    "prompt": "请总结以下工单：{{node_fetch_ticket.output.text}}"
  }
}
```

节点输入字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | 单轮提问（与 `messages` 二选一） |
| `system` | string | 系统指令（人设/规则） |
| `messages` | array | 完整多轮对话 `[{role, content}]`（优先于 prompt） |
| `provider` | string | 指定厂商（失败自动回退到其余已配置厂商） |
| `model` | string | 指定模型（缺省用该厂商默认） |
| `temperature` | number | 0–2，越高越随机 |
| `max_tokens` | number | 输出长度上限 |

节点输出：`{ content, model, usage, finish_reason }`，下游节点可用 `{{node_summarize.output.content}}` 引用。

**变量插值**：`config` 支持 `{{trigger.payload.*}}` 与 `{{node_X.output.*}}`（含嵌套路径），可把上游数据直接喂给 AI。

### 4.2 REST API（直接调用）

```bash
# 查看当前已配置的厂商与状态
curl http://localhost:3000/api/v1/llm/providers

# 单次补全（等价于 llm.complete 节点）
curl -X POST http://localhost:3000/api/v1/llm/complete \
  -H 'content-type: application/json' \
  -d '{"prompt":"把这句话翻译成英文：今天天气很好","provider":"deepseek"}'
```

- 未指定 `provider`：按 `LOOP_LLM_FALLBACK_CHAIN` 顺序尝试。
- 指定 `provider`：该厂商优先，其余已配置厂商作为回退；厂商名不存在时返回明确错误（不会静默换厂商）。
- 所有失败都返回结构化错误（`UPSTREAM_LLM_UNAVAILABLE` + 上游状态码/报文摘要），**绝不静默返回空内容**。

### 4.3 Embedding（向量）

Ollama 支持批量 embedding（`POST /api/embed`），通过 `router.embed()` 供 RAG 类扩展使用：

```ts
const { embeddings } = await router.embed({ model: 'nomic-embed-text', input: ['文本A', '文本B'] });
```

---

## 五、运维注意事项

1. **密钥安全**：`LOOP_LLM_*_KEY` 与其他密钥同等管理；生产环境不要提交到仓库。可配合 Secrets 管理体系注入。
2. **出口管控**：开启 `LOOP_AIRGAP_MODE=true` 后所有 AI 调用一并被拦截——无论来自工作流 `llm.complete` 节点还是 `POST /api/v1/llm/complete` 直连 API（两者共用同一个 `EgressGate`）。本地 Ollama 也会被拦，如需放行请为 Ollama 地址配置 allow 策略（`target_type: domain` 填 `localhost`，通过 `POST /api/v1/egress/policies` 管理，见下）。
3. **超时**：`LOOP_LLM_TIMEOUT_MS`（默认 120 秒）约束单次 HTTP 调用；工作流层面的 `workflow_timeout_ms` 仍生效并可通过 signal 中断进行中的 AI 请求。
4. **可观测**：`GET /api/v1/llm/providers` 返回每家厂商的熔断状态与失败次数，可直接接监控面板。
5. **成本控制**：建议便宜/快的厂商做主力，昂贵/强模型通过节点级 `provider`/`model` 按需指定；失败自动回退避免单点。
6. **Bedrock / Vertex**：目前为占位实现（需 AWS/GCP SDK），`isAvailable()` 恒为 false 且不会注册——避免误选返回空内容。需要时接入 SDK 后在 `factory.ts` 注册即可。
7. **Gemini 双通道**：既可用原生客户端（`LOOP_LLM_GEMINI_KEY`），也可把 OpenAI 兼容客户端指向 `https://generativelanguage.googleapis.com/v1beta/openai` 走兼容协议。

---

## 六、开发扩展：新增一个厂商

1. **OpenAI 兼容**（90% 的情况）：在 `packages/llm/src/presets.ts` 加一条预设（baseUrl + defaultModel），再在 `factory.ts` 的 `COMPAT_KEY_GATED` 数组加一行映射（`LOOP_LLM_<名字>_KEY/_MODEL` 变量自动生效）。
2. **专有协议**：实现 `LLMProvider` 接口（参考 `gemini.ts`），在 `factory.ts` 注册。请求里务必：检查 HTTP 状态码、消费响应体、透传 `io.egress`/`io.signal`、提供 `defaultModel`。
3. **测试**：参考 `tests/unit/llm/providers.test.ts`（mock undici 验证请求形状与错误路径）。

## 七、相关代码索引

| 模块 | 位置 |
|------|------|
| Provider 接口 | `packages/llm/src/interface.ts` |
| OpenAI 兼容客户端 | `packages/llm/src/openai.ts` |
| 厂商预设表 | `packages/llm/src/presets.ts` |
| 原生 Gemini / Anthropic | `packages/llm/src/gemini.ts`、`packages/llm/src/anthropic.ts` |
| 路由（熔断/回退） | `packages/llm/src/router.ts` |
| 环境变量工厂 | `packages/llm/src/factory.ts` |
| 工作流节点 | `packages/connectors/src/llm/adapter.ts`（`llm.complete`） |
| API 端点 | `apps/api/src/routes/index.ts`（`/api/v1/llm/*`） |
| 测试 | `tests/unit/llm/`、`tests/unit/connectors/llm-adapter.test.ts`、`tests/integration/api/llm.test.ts` |
