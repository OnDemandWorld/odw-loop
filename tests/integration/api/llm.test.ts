/**
 * Integration tests — LLM API (/api/v1/llm/*).
 *
 * The test app registers only the loopback Ollama provider (nothing listens
 * on 11434 in CI), so the complete endpoint is exercised for its *contract*:
 * validation, provider resolution errors, and the error envelope — never a
 * real model call.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, type TestApp } from '../_helpers/app.js';

describe('LLM API (/api/v1/llm/*)', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  it('GET /providers lists the configured vendors with circuit state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/llm/providers' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const names = body.data.map((p: { name: string }) => p.name);
    expect(names).toContain('ollama');
    for (const p of body.data) {
      expect(p.circuit).toBeDefined();
    }
  });

  it('POST /complete rejects bodies without prompt or messages (400)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/llm/complete', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /complete rejects unknown providers with a 400 (B5)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/complete',
      payload: { prompt: 'hi', provider: 'no-such-vendor' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_REQUIRED');
    expect(JSON.stringify(res.json())).toContain('Unknown LLM provider');
  });

  it('POST /complete is blocked by the egress gate in airgap mode (B1)', async () => {
    // The API-side LLM path must pass the same gate as workflow nodes —
    // otherwise airgap mode leaks through /api/v1/llm/complete.
    const ctxAir = await buildTestApp({ LOOP_AIRGAP_MODE: true });
    try {
      await ctxAir.app.ready();
      const res = await ctxAir.app.inject({
        method: 'POST',
        url: '/api/v1/llm/complete',
        payload: { prompt: 'hello' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NODE_EGRESS_BLOCKED');
    } finally {
      await ctxAir.app.close();
      ctxAir.conn.close();
    }
  });

  it('POST /complete surfaces provider failures as an error envelope (no silent empty reply)', async () => {
    // Nothing listens on the loopback Ollama URL — the router must fail with
    // a structured error rather than returning empty content.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/llm/complete',
      payload: { prompt: 'hello' },
    });
    expect([500, 502, 503]).toContain(res.statusCode);
    expect(res.json().success).toBe(false);
  });

  it('POST /complete maps prompt+system onto the router request', async () => {
    // Spy on the router behind the API to verify request mapping without a
    // live model.
    const completeSpy = vi.spyOn(ctx.llmRouter, 'complete').mockResolvedValue({
      content: 'ok',
      model: 'ollama-default',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finish_reason: 'stop',
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/llm/complete',
        payload: { prompt: 'hello', system: 'be brief', temperature: 0.1 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ content: 'ok', model: 'ollama-default' });
      const [req] = completeSpy.mock.calls[0]!;
      expect(req.messages).toEqual([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ]);
      expect(req.temperature).toBe(0.1);
    } finally {
      completeSpy.mockRestore();
    }
  });
});
