/**
 * Vendor presets — default base URLs and models for every provider the
 * OpenAI-compatible client can talk to. Adding a vendor = adding an entry
 * here (plus optional env wiring in the factory); no new client code.
 */

export interface VendorPreset {
  /** Base URL of the OpenAI-compatible API root. */
  baseUrl: string;
  /** Sensible default model when the request doesn't name one. */
  defaultModel: string;
  /** Human-readable label (shown in the providers API). */
  label: string;
  /** How the vendor authenticates. */
  auth: 'bearer' | 'none';
}

export const PROVIDER_PRESETS: Record<string, VendorPreset> = {
  // ── Cloud vendors, OpenAI-compatible endpoints ──────────────────────────
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', label: 'OpenAI', auth: 'bearer' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', label: 'DeepSeek 深度求索', auth: 'bearer' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', label: '阿里云百炼 Qwen', auth: 'bearer' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', label: 'Moonshot Kimi', auth: 'bearer' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', label: '智谱 GLM', auth: 'bearer' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'deepseek-ai/DeepSeek-V3', label: 'SiliconFlow 硅基流动', auth: 'bearer' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', label: 'Groq', auth: 'bearer' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', label: 'Mistral', auth: 'bearer' },
  together: { baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Together AI', auth: 'bearer' },
  xai: { baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-2-latest', label: 'xAI Grok', auth: 'bearer' },

  // ── Local inference servers (no key required) ───────────────────────────
  vllm: { baseUrl: 'http://localhost:8000/v1', defaultModel: 'local-model', label: 'vLLM (本地)', auth: 'none' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', label: 'LM Studio (本地)', auth: 'none' },
};
