/**
 * Unit tests for the concrete LLM providers (mocked HTTP via undici).
 * Covers: request shapes per vendor, response parsing, HTTP status checks
 * (previously a 401 silently produced an empty completion), and per-vendor
 * default models.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('undici', () => ({ request: vi.fn() }));
vi.mock('@loop/observability', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { request } from 'undici';
import { OpenAICompatibleProvider, isLocalUrl } from '../../../packages/llm/src/openai';
import { AnthropicProvider } from '../../../packages/llm/src/anthropic';
import { GeminiProvider } from '../../../packages/llm/src/gemini';
import { OllamaProvider } from '../../../packages/llm/src/ollama';
import { PROVIDER_PRESETS } from '../../../packages/llm/src/presets';
import type { CompletionRequest } from '../../../packages/llm/src/interface';

const requestMock = request as unknown as ReturnType<typeof vi.fn>;

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    body: { json: async () => body, text: async () => JSON.stringify(body) },
  };
}

const baseReq: CompletionRequest = {
  model: 'test-model',
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
  ],
};

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('sends an OpenAI-shaped request and parses the reply', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, {
      choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
    }));
    const provider = new OpenAICompatibleProvider('deepseek', 'sk-test', 'https://api.deepseek.com/v1', 'deepseek-chat');

    const result = await provider.complete(baseReq);

    expect(result).toMatchObject({ content: 'hi there', finish_reason: 'stop' });
    expect(result.usage.total_tokens).toBe(12);
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(String(opts.body));
    expect(body.model).toBe('test-model');
    expect(opts.headers.authorization).toBe('Bearer sk-test');
  });

  it('throws on HTTP errors instead of returning an empty completion', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'bad key' } }));
    const provider = new OpenAICompatibleProvider('openai', 'sk-bad');
    await expect(provider.complete(baseReq)).rejects.toMatchObject({ code: 'UPSTREAM_LLM_UNAVAILABLE' });
  });

  it('omits the Authorization header for keyless local servers', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'x' } }] }));
    const provider = new OpenAICompatibleProvider('lmstudio', undefined, 'http://localhost:1234/v1', 'local-model');
    await provider.complete(baseReq);
    expect(requestMock.mock.calls[0]![1].headers.authorization).toBeUndefined();
  });

  it('checks egress before dispatching', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'x' } }] }));
    const provider = new OpenAICompatibleProvider('openai', 'sk-test');
    const egress = { check: vi.fn().mockRejectedValue(new Error('blocked')) };
    await expect(provider.complete(baseReq, { egress })).rejects.toMatchObject({ message: 'blocked' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('isAvailable requires a key for remote URLs, none for local', () => {
    expect(new OpenAICompatibleProvider('openai', 'sk-x').isAvailable()).resolves.toBe(true);
    expect(new OpenAICompatibleProvider('openai', undefined, 'https://api.openai.com/v1').isAvailable()).resolves.toBe(false);
    expect(new OpenAICompatibleProvider('lmstudio', undefined, 'http://localhost:1234/v1').isAvailable()).resolves.toBe(true);
  });
});

describe('AnthropicProvider', () => {
  beforeEach(() => requestMock.mockReset());

  it('extracts the system message and maps usage fields', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, {
      content: [{ text: 'answer' }],
      usage: { input_tokens: 10, output_tokens: 4 },
      stop_reason: 'end_turn',
    }));
    const provider = new AnthropicProvider('ak-test', 'claude-3-5-haiku-latest');

    const result = await provider.complete(baseReq);

    expect(result).toMatchObject({ content: 'answer', finish_reason: 'end_turn' });
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(opts.body));
    expect(body.system).toBe('be brief');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.max_tokens).toBe(4096); // Anthropic requires max_tokens
    expect(opts.headers['x-api-key']).toBe('ak-test');
  });

  it('throws on HTTP errors', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: 'rate limited' } }));
    const provider = new AnthropicProvider('ak-test');
    await expect(provider.complete(baseReq)).rejects.toMatchObject({ code: 'UPSTREAM_LLM_UNAVAILABLE' });
  });
});

describe('GeminiProvider', () => {
  beforeEach(() => requestMock.mockReset());

  it('maps messages to contents + systemInstruction and parses candidates', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: 'gemini reply' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3, totalTokenCount: 9 },
    }));
    const provider = new GeminiProvider('g-key', 'gemini-2.0-flash');

    const result = await provider.complete(baseReq);

    expect(result).toMatchObject({ content: 'gemini reply', finish_reason: 'STOP' });
    expect(result.usage.total_tokens).toBe(9);
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toContain('/models/test-model:generateContent');
    const body = JSON.parse(String(opts.body));
    expect(body.systemInstruction.parts[0].text).toBe('be brief');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(opts.headers['x-goog-api-key']).toBe('g-key');
  });

  it('refuses to run unconfigured', async () => {
    const provider = new GeminiProvider(undefined);
    await expect(provider.complete(baseReq)).rejects.toMatchObject({ code: 'UPSTREAM_LLM_UNAVAILABLE' });
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => requestMock.mockReset());

  it('chats via /api/chat and maps eval counts', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, {
      message: { content: 'local answer' },
      prompt_eval_count: 9,
      eval_count: 11,
    }));
    const provider = new OllamaProvider('http://localhost:11434', 'llama3.1');

    const result = await provider.complete({ model: 'llama3.1', messages: [{ role: 'user', content: 'hi' }] });

    expect(result).toMatchObject({ content: 'local answer' });
    expect(result.usage).toEqual({ prompt_tokens: 9, completion_tokens: 11, total_tokens: 20 });
    expect(requestMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/chat');
  });

  it('embeds in one batch via /api/embed', async () => {
    requestMock.mockResolvedValueOnce(jsonResponse(200, { embeddings: [[1, 2], [3, 4]] }));
    const provider = new OllamaProvider();

    const result = await provider.embed!({ model: 'nomic-embed-text', input: ['a', 'b'] });

    expect(result.embeddings).toEqual([[1, 2], [3, 4]]);
    const body = JSON.parse(String(requestMock.mock.calls[0]![1].body));
    expect(body.input).toEqual(['a', 'b']);
  });
});

describe('presets', () => {
  it('covers the mainstream cloud vendors and local servers', () => {
    for (const name of ['openai', 'deepseek', 'qwen', 'moonshot', 'zhipu', 'siliconflow', 'groq', 'mistral', 'together', 'xai', 'vllm', 'lmstudio']) {
      const preset = PROVIDER_PRESETS[name];
      expect(preset?.baseUrl, `preset ${name}`).toMatch(/^https?:\/\//);
      expect(preset?.defaultModel.length, `preset ${name} model`).toBeGreaterThan(0);
    }
  });

  it('isLocalUrl detects loopback', () => {
    expect(isLocalUrl('http://localhost:11434')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:8000/v1')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
  });
});

describe('Provider deadlines — combined signals (audit #50)', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('the provider timeout still applies when an executor signal is present', async () => {
    // undici mock: reject when the passed signal aborts (like real undici).
    requestMock.mockImplementation((_url: string, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) { reject(new Error('request aborted')); return; }
        opts.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
      }),
    );
    const provider = new OpenAICompatibleProvider('test', 'sk', 'https://api.test.example/v1', 'm', 30);
    const executorController = new AbortController(); // never aborts during the test
    await expect(
      provider.complete(baseReq, { signal: executorController.signal }),
    ).rejects.toThrow('request aborted');
    expect(executorController.signal.aborted).toBe(false);
  });

  it('an executor abort still cancels the request', async () => {
    requestMock.mockImplementation((_url: string, opts: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        if (opts.signal?.aborted) { reject(new Error('request aborted')); return; }
        opts.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
      }),
    );
    const provider = new OpenAICompatibleProvider('test', 'sk', 'https://api.test.example/v1', 'm', 60_000);
    const executorController = new AbortController();
    const pending = provider.complete(baseReq, { signal: executorController.signal });
    executorController.abort();
    await expect(pending).rejects.toThrow('request aborted');
  });
});

describe('Provider response guards (audit #49, #51)', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('Gemini prompt-level block surfaces as an error, not an empty success', async () => {
    requestMock.mockResolvedValue(jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    const provider = new GeminiProvider('gk');
    await expect(provider.complete(baseReq)).rejects.toThrow(/prompt blocked: SAFETY/);
  });

  it('a non-JSON 200 (proxy login page) fails as UpstreamError, not SyntaxError', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        text: async () => '<!DOCTYPE html><html>login</html>',
        json: async () => { throw new SyntaxError('Unexpected token <'); },
      },
    });
    const provider = new OpenAICompatibleProvider('test', 'sk', 'https://api.test.example/v1');
    await expect(provider.complete(baseReq)).rejects.toThrow(/non-JSON response/);
  });
});
