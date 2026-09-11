/**
 * Factory — builds an LLMRouter from LoopConfig (env vars).
 *
 * Which providers get instantiated:
 *   - Cloud vendors: instantiated when their API key is configured.
 *   - Local servers (ollama): always instantiated (loopback default, no key).
 *   - Local servers (vllm / lmstudio): instantiated only when their URL is
 *     explicitly set, so a stray default URL never hijacks the fallback chain.
 *   - Custom OpenAI-compatible endpoints: via LOOP_LLM_EXTRA_PROVIDERS JSON.
 *
 * Bedrock/Vertex remain stubs and are never registered (see their files).
 */

import { createLogger } from '@loop/observability';
import { PROVIDER_PRESETS } from './presets.js';
import { OpenAICompatibleProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';
import { AzureOpenAIProvider } from './azure.js';
import { LLMRouter } from './router.js';
import type { LLMProvider } from './interface.js';

const logger = createLogger({ name: 'loop:llm:factory', component: 'llm' });

/** Minimal shape of the config the factory needs (subset of LoopConfig). */
export interface LLMFactoryConfig {
  LOOP_LLM_PRIMARY: string;
  LOOP_LLM_FALLBACK_CHAIN: string;
  LOOP_LLM_TIMEOUT_MS?: number;
  LOOP_LLM_OLLAMA_URL?: string;
  LOOP_LLM_OLLAMA_MODEL?: string;
  LOOP_LLM_OPENAI_KEY?: string;
  LOOP_LLM_OPENAI_BASE_URL?: string;
  LOOP_LLM_OPENAI_MODEL?: string;
  LOOP_LLM_ANTHROPIC_KEY?: string;
  LOOP_LLM_ANTHROPIC_BASE_URL?: string;
  LOOP_LLM_ANTHROPIC_MODEL?: string;
  LOOP_LLM_GEMINI_KEY?: string;
  LOOP_LLM_GEMINI_BASE_URL?: string;
  LOOP_LLM_GEMINI_MODEL?: string;
  LOOP_LLM_AZURE_ENDPOINT?: string;
  LOOP_LLM_AZURE_KEY?: string;
  LOOP_LLM_AZURE_MODEL?: string;
  LOOP_LLM_AZURE_API_VERSION?: string;
  // OpenAI-compatible cloud vendors (key-gated, preset base URLs).
  LOOP_LLM_DEEPSEEK_KEY?: string;
  LOOP_LLM_DEEPSEEK_MODEL?: string;
  LOOP_LLM_DEEPSEEK_BASE_URL?: string;
  LOOP_LLM_QWEN_KEY?: string;
  LOOP_LLM_QWEN_MODEL?: string;
  LOOP_LLM_QWEN_BASE_URL?: string;
  LOOP_LLM_MOONSHOT_KEY?: string;
  LOOP_LLM_MOONSHOT_MODEL?: string;
  LOOP_LLM_MOONSHOT_BASE_URL?: string;
  LOOP_LLM_ZHIPU_KEY?: string;
  LOOP_LLM_ZHIPU_MODEL?: string;
  LOOP_LLM_ZHIPU_BASE_URL?: string;
  LOOP_LLM_SILICONFLOW_KEY?: string;
  LOOP_LLM_SILICONFLOW_MODEL?: string;
  LOOP_LLM_SILICONFLOW_BASE_URL?: string;
  LOOP_LLM_GROQ_KEY?: string;
  LOOP_LLM_GROQ_MODEL?: string;
  LOOP_LLM_MISTRAL_KEY?: string;
  LOOP_LLM_MISTRAL_MODEL?: string;
  LOOP_LLM_TOGETHER_KEY?: string;
  LOOP_LLM_TOGETHER_MODEL?: string;
  LOOP_LLM_XAI_KEY?: string;
  LOOP_LLM_XAI_MODEL?: string;
  // Local OpenAI-compatible servers (URL-gated).
  LOOP_LLM_VLLM_URL?: string;
  LOOP_LLM_VLLM_MODEL?: string;
  LOOP_LLM_LMSTUDIO_URL?: string;
  LOOP_LLM_LMSTUDIO_MODEL?: string;
  // Custom OpenAI-compatible endpoints, JSON array:
  // [{"name":"myai","base_url":"https://…/v1","api_key":"…","model":"…"}]
  LOOP_LLM_EXTRA_PROVIDERS?: string;
}

/** Cloud vendors that use the OpenAI-compatible client with a preset URL. */
const COMPAT_KEY_GATED: Array<{ name: string; keyVar: keyof LLMFactoryConfig; modelVar: keyof LLMFactoryConfig; baseUrlVar?: keyof LLMFactoryConfig }> = [
  { name: 'deepseek', keyVar: 'LOOP_LLM_DEEPSEEK_KEY', modelVar: 'LOOP_LLM_DEEPSEEK_MODEL', baseUrlVar: 'LOOP_LLM_DEEPSEEK_BASE_URL' },
  { name: 'qwen', keyVar: 'LOOP_LLM_QWEN_KEY', modelVar: 'LOOP_LLM_QWEN_MODEL', baseUrlVar: 'LOOP_LLM_QWEN_BASE_URL' },
  { name: 'moonshot', keyVar: 'LOOP_LLM_MOONSHOT_KEY', modelVar: 'LOOP_LLM_MOONSHOT_MODEL', baseUrlVar: 'LOOP_LLM_MOONSHOT_BASE_URL' },
  { name: 'zhipu', keyVar: 'LOOP_LLM_ZHIPU_KEY', modelVar: 'LOOP_LLM_ZHIPU_MODEL', baseUrlVar: 'LOOP_LLM_ZHIPU_BASE_URL' },
  { name: 'siliconflow', keyVar: 'LOOP_LLM_SILICONFLOW_KEY', modelVar: 'LOOP_LLM_SILICONFLOW_MODEL', baseUrlVar: 'LOOP_LLM_SILICONFLOW_BASE_URL' },
  { name: 'groq', keyVar: 'LOOP_LLM_GROQ_KEY', modelVar: 'LOOP_LLM_GROQ_MODEL' },
  { name: 'mistral', keyVar: 'LOOP_LLM_MISTRAL_KEY', modelVar: 'LOOP_LLM_MISTRAL_MODEL' },
  { name: 'together', keyVar: 'LOOP_LLM_TOGETHER_KEY', modelVar: 'LOOP_LLM_TOGETHER_MODEL' },
  { name: 'xai', keyVar: 'LOOP_LLM_XAI_KEY', modelVar: 'LOOP_LLM_XAI_MODEL' },
];

export function createLLMRouter(cfg: LLMFactoryConfig): LLMRouter {
  const timeoutMs = cfg.LOOP_LLM_TIMEOUT_MS;
  const providers: LLMProvider[] = [];

  // Local-first: Ollama is always registered (loopback default, keyless).
  providers.push(new OllamaProvider(cfg.LOOP_LLM_OLLAMA_URL ?? 'http://localhost:11434', cfg.LOOP_LLM_OLLAMA_MODEL, timeoutMs));

  if (cfg.LOOP_LLM_OPENAI_KEY) {
    providers.push(new OpenAICompatibleProvider('openai', cfg.LOOP_LLM_OPENAI_KEY, cfg.LOOP_LLM_OPENAI_BASE_URL ?? PROVIDER_PRESETS['openai']!.baseUrl, cfg.LOOP_LLM_OPENAI_MODEL ?? PROVIDER_PRESETS['openai']!.defaultModel, timeoutMs));
  }
  if (cfg.LOOP_LLM_ANTHROPIC_KEY) {
    providers.push(new AnthropicProvider(cfg.LOOP_LLM_ANTHROPIC_KEY, cfg.LOOP_LLM_ANTHROPIC_MODEL, cfg.LOOP_LLM_ANTHROPIC_BASE_URL, timeoutMs));
  }
  if (cfg.LOOP_LLM_GEMINI_KEY) {
    providers.push(new GeminiProvider(cfg.LOOP_LLM_GEMINI_KEY, cfg.LOOP_LLM_GEMINI_MODEL, cfg.LOOP_LLM_GEMINI_BASE_URL, timeoutMs));
  }
  if (cfg.LOOP_LLM_AZURE_ENDPOINT && cfg.LOOP_LLM_AZURE_KEY) {
    providers.push(new AzureOpenAIProvider(cfg.LOOP_LLM_AZURE_ENDPOINT, cfg.LOOP_LLM_AZURE_KEY, cfg.LOOP_LLM_AZURE_MODEL, cfg.LOOP_LLM_AZURE_API_VERSION, timeoutMs));
  }

  for (const vendor of COMPAT_KEY_GATED) {
    const apiKey = cfg[vendor.keyVar] as string | undefined;
    if (!apiKey) continue;
    const preset = PROVIDER_PRESETS[vendor.name]!;
    providers.push(
      new OpenAICompatibleProvider(
        vendor.name,
        apiKey,
        (vendor.baseUrlVar !== undefined ? (cfg[vendor.baseUrlVar] as string | undefined) : undefined) ?? preset.baseUrl,
        (cfg[vendor.modelVar] as string | undefined) ?? preset.defaultModel,
        timeoutMs,
      ),
    );
  }

  if (cfg.LOOP_LLM_VLLM_URL) {
    providers.push(new OpenAICompatibleProvider('vllm', undefined, cfg.LOOP_LLM_VLLM_URL, cfg.LOOP_LLM_VLLM_MODEL ?? 'local-model', timeoutMs));
  }
  if (cfg.LOOP_LLM_LMSTUDIO_URL) {
    providers.push(new OpenAICompatibleProvider('lmstudio', undefined, cfg.LOOP_LLM_LMSTUDIO_URL, cfg.LOOP_LLM_LMSTUDIO_MODEL ?? 'local-model', timeoutMs));
  }

  // Custom OpenAI-compatible endpoints (self-hosted gateways, niche vendors…).
  if (cfg.LOOP_LLM_EXTRA_PROVIDERS) {
    try {
      const extras = JSON.parse(cfg.LOOP_LLM_EXTRA_PROVIDERS) as Array<{ name?: string; base_url?: string; api_key?: string; model?: string }>;
      for (const extra of Array.isArray(extras) ? extras : []) {
        if (!extra?.name || !extra?.base_url) {
          logger.warn({ extra }, 'LOOP_LLM_EXTRA_PROVIDERS entry missing name/base_url — skipped');
          continue;
        }
        providers.push(new OpenAICompatibleProvider(extra.name, extra.api_key, extra.base_url, extra.model ?? 'default', timeoutMs));
      }
    } catch (err) {
      logger.error({ error: String(err) }, 'LOOP_LLM_EXTRA_PROVIDERS is not valid JSON — ignored');
    }
  }

  // Sanity-check the primary + fallback chain against what was registered.
  const names = new Set(providers.map((p) => p.name));
  const chain = cfg.LOOP_LLM_FALLBACK_CHAIN.split(',').map((s) => s.trim()).filter(Boolean);
  const resolvedChain = chain.filter((n) => names.has(n));
  if (resolvedChain.length === 0) {
    // Guarantee at least the primary (or ollama) is in the chain.
    resolvedChain.push(names.has(cfg.LOOP_LLM_PRIMARY) ? cfg.LOOP_LLM_PRIMARY : 'ollama');
  }
  if (resolvedChain.length < chain.length) {
    logger.warn(
      { configured: chain, resolved: resolvedChain, registered: [...names] },
      'Some providers in LOOP_LLM_FALLBACK_CHAIN are not configured — they will be skipped',
    );
  }

  // Reorder providers so the primary and the configured chain come first;
  // any registered-but-unlisted providers remain as last-resort tail.
  const ordered = [
    ...resolvedChain.map((name) => providers.find((p) => p.name === name)!),
    ...providers.filter((p) => !resolvedChain.includes(p.name)),
  ];

  logger.info({ providers: ordered.map((p) => p.name), primary: resolvedChain[0] }, 'LLM router built');
  return new LLMRouter(ordered);
}

// Re-export for type consumers.
export type { LLMProvider };
