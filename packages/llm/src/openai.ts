/**
 * OpenAI-compatible provider — the universal client.
 *
 * Talks the `/chat/completions` dialect, which covers OpenAI itself plus the
 * vast majority of the market: DeepSeek, Qwen (DashScope compatible mode),
 * Moonshot Kimi, Zhipu GLM, SiliconFlow, Groq, Mistral, Together, xAI,
 * Google Gemini's OpenAI-compat endpoint, and local servers (vLLM, LM Studio,
 * Ollama's `/v1`). Point `baseUrl` at any of them.
 */

import { request } from 'undici';
import { UpstreamError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, ProviderIO } from './interface.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly defaultModel?: string;

  constructor(
    name: string,
    private apiKey: string | undefined,
    private baseUrl: string = 'https://api.openai.com/v1',
    defaultModel?: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.name = name;
    this.defaultModel = defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Ollama/LM Studio/vLLM accept requests without a key; only send the
        // header when a key is configured.
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        stream: false,
      }),
      signal: io?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      // Drain the body so the socket returns to the pool, then surface the
      // upstream message — a silent empty reply used to hide auth/model errors.
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError(
        'UPSTREAM_LLM_UNAVAILABLE',
        `${this.name} chat/completions returned ${response.statusCode}: ${detail.slice(0, 500)}`,
      );
    }

    const data = await response.body.json() as {
      choices?: Array<{ message?: { content: string }; finish_reason?: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      error?: { message?: string };
    };
    if (data.error) {
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `${this.name} returned an error: ${data.error.message ?? 'unknown'}`);
    }
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: req.model,
      usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: data.choices?.[0]?.finish_reason ?? 'stop',
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey !== undefined || isLocalUrl(this.baseUrl);
  }
}

/** Back-compat alias — the original provider name kept as the OpenAI preset. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string | undefined, baseUrl = 'https://api.openai.com/v1', defaultModel?: string, timeoutMs?: number) {
    super('openai', apiKey, baseUrl, defaultModel, timeoutMs);
  }
}

/** True when the URL points at loopback — local inference servers need no key. */
export function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(parsed.hostname) || parsed.hostname === '::1';
  } catch {
    return false;
  }
}
