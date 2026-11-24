/**
 * Google Gemini provider — native `generateContent` API.
 *
 * (Gemini also exposes an OpenAI-compatible endpoint; use the `openai`
 * compatible client pointed at `…/v1beta/openai` if you prefer a single
 * client. This native client avoids that indirection.)
 */

import { request } from 'undici';
import { UpstreamError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, ProviderIO } from './interface.js';

const DEFAULT_TIMEOUT_MS = 120_000;

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly defaultModel?: string;

  constructor(
    private apiKey: string | undefined,
    defaultModel = 'gemini-2.0-flash',
    private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta',
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.defaultModel = defaultModel;
  }

  async complete(req: CompletionRequest, io?: ProviderIO): Promise<CompletionResponse> {
    if (!this.apiKey) {
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', 'Gemini provider is not configured (missing LOOP_LLM_GEMINI_KEY)');
    }

    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const contents: GeminiContent[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const url = `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`;
    await io?.egress?.check(url);

    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: {
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.max_tokens !== undefined ? { maxOutputTokens: req.max_tokens } : {}),
        },
      }),
      signal: io?.signal ? AbortSignal.any([io.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text().catch(() => '');
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Gemini returned ${response.statusCode}: ${detail.slice(0, 500)}`);
    }

    const data = await response.body.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
      error?: { message?: string };
    };
    if (data.error) {
      throw new UpstreamError('UPSTREAM_LLM_UNAVAILABLE', `Gemini returned an error: ${data.error.message ?? 'unknown'}`);
    }

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    const prompt = data.usageMetadata?.promptTokenCount ?? 0;
    const completion = data.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      content: text,
      model: req.model,
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: data.usageMetadata?.totalTokenCount ?? prompt + completion },
      finish_reason: data.candidates?.[0]?.finishReason ?? 'STOP',
    };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}
