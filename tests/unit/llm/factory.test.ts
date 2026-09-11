/**
 * Factory tests — LOOP_LLM_* env vars → registered providers + chain order.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@loop/observability', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { createLLMRouter } from '../../../packages/llm/src/factory';
import type { LLMFactoryConfig } from '../../../packages/llm/src/factory';

function cfg(overrides: Partial<LLMFactoryConfig> = {}): LLMFactoryConfig {
  return {
    LOOP_LLM_PRIMARY: 'ollama',
    LOOP_LLM_FALLBACK_CHAIN: 'ollama,openai,anthropic',
    ...overrides,
  };
}

describe('createLLMRouter', () => {
  it('always registers ollama; keyed vendors register only with a key', () => {
    const bare = createLLMRouter(cfg()).listProviders().map((p) => p.name);
    expect(bare).toEqual(['ollama']);

    const full = createLLMRouter(cfg({
      LOOP_LLM_OPENAI_KEY: 'sk',
      LOOP_LLM_ANTHROPIC_KEY: 'ak',
      LOOP_LLM_GEMINI_KEY: 'gk',
      LOOP_LLM_DEEPSEEK_KEY: 'dk',
      LOOP_LLM_QWEN_KEY: 'qk',
      LOOP_LLM_ZHIPU_KEY: 'zk',
    })).listProviders().map((p) => p.name);
    expect(full).toEqual(['ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'qwen', 'zhipu']);
  });

  it('chains follow LOOP_LLM_FALLBACK_CHAIN order with the primary first', () => {
    const router = createLLMRouter(cfg({
      LOOP_LLM_PRIMARY: 'openai',
      LOOP_LLM_FALLBACK_CHAIN: 'openai,deepseek',
      LOOP_LLM_OPENAI_KEY: 'sk',
      LOOP_LLM_DEEPSEEK_KEY: 'dk',
    }));
    expect(router.listProviders().map((p) => p.name)).toEqual(['openai', 'deepseek', 'ollama']);
  });

  it('unconfigured vendors in the chain are skipped with a warning, not fatal', () => {
    const names = createLLMRouter(cfg({ LOOP_LLM_FALLBACK_CHAIN: 'ollama,openai' })).listProviders().map((p) => p.name);
    expect(names).toEqual(['ollama']);
  });

  it('uses preset base URLs and default models for compat vendors', () => {
    const router = createLLMRouter(cfg({ LOOP_LLM_DEEPSEEK_KEY: 'dk' }));
    const deepseek = router.listProviders().find((p) => p.name === 'deepseek');
    expect(deepseek?.defaultModel).toBe('deepseek-chat');
  });

  it('local servers register only when their URL is explicitly set', () => {
    const names = createLLMRouter(cfg({
      LOOP_LLM_VLLM_URL: 'http://127.0.0.1:8000/v1',
      LOOP_LLM_LMSTUDIO_URL: 'http://127.0.0.1:1234/v1',
    })).listProviders().map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['vllm', 'lmstudio']));
  });

  it('parses LOOP_LLM_EXTRA_PROVIDERS JSON for custom compatible endpoints', () => {
    const names = createLLMRouter(cfg({
      LOOP_LLM_EXTRA_PROVIDERS: JSON.stringify([
        { name: 'myai', base_url: 'https://llm.internal.corp/v1', api_key: 'k', model: 'corporate-large' },
        { name: 'broken' }, // missing base_url → skipped
      ]),
    })).listProviders();
    const myai = names.find((p) => p.name === 'myai');
    expect(myai?.defaultModel).toBe('corporate-large');
    expect(names.find((p) => p.name === 'broken')).toBeUndefined();
  });

  it('never registers the bedrock/vertex stubs (they cannot complete)', () => {
    const names = createLLMRouter(cfg()).listProviders().map((p) => p.name);
    expect(names).not.toContain('bedrock');
    expect(names).not.toContain('vertex');
  });
});
