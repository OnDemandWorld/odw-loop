/**
 * E2E — Egress policy enforcement.
 *
 * Verifies that the EgressEngine + EgressGate combination correctly
 * enforces domain-level policies. The interceptor is wired into a workflow's
 * connector call path; the test asserts:
 *
 *   1. With no policies, default-deny blocks external calls.
 *   2. Adding an allow rule for a specific domain permits that domain.
 *   3. Other domains remain blocked.
 *   4. Priority ordering is respected (higher priority wins).
 *   5. Policy cache invalidation reflects live DB changes.
 */

import http from 'node:http';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import { EgressGate } from '../../packages/egress/src/interceptor';
import { GenericAdapter } from '../../packages/connectors/src';
import { ExecutionExecutor } from '../../packages/engine/src';
import type { WorkflowDefinition } from '../../packages/types';

import { createTestContext, createNode, type TestContext } from './helpers';

describe('Egress policy enforcement (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('denies all external calls by default when no policies exist', async () => {
    const decision = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/No matching allow policy/);
  });

  it('blocks external API call with a deny-all policy', async () => {
    await ctx.store.egressPolicies.create({
      id: 'deny-all',
      name: 'Deny all',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.openai.com',
      priority: 100,
    });
    ctx.egressEngine.invalidateCache();

    const decision = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(decision.allowed).toBe(false);
    expect(decision.matched_policy).toBe('deny-all');
  });

  it('allows calls to a specific domain after adding an allow rule', async () => {
    // Start with deny-all for openai
    await ctx.store.egressPolicies.create({
      id: 'deny-openai',
      name: 'Deny OpenAI',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.openai.com',
      priority: 100,
    });

    // Add a higher-priority allow rule for a sub-domain
    await ctx.store.egressPolicies.create({
      id: 'allow-platform',
      name: 'Allow platform.openai.com',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'platform.openai.com',
      priority: 200,
    });
    ctx.egressEngine.invalidateCache();

    const allowed = await ctx.egressEngine.evaluate('https://platform.openai.com/v1/chat');
    expect(allowed.allowed).toBe(true);
    expect(allowed.matched_policy).toBe('allow-platform');

    // But api.openai.com is still blocked
    const blocked = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(blocked.allowed).toBe(false);
  });

  it('respects priority ordering: higher priority wins', async () => {
    await ctx.store.egressPolicies.create({
      id: 'low-deny',
      name: 'Low deny',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.example.com',
      priority: 100,
    });
    await ctx.store.egressPolicies.create({
      id: 'high-allow',
      name: 'High allow',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: '*.example.com',
      priority: 500,
    });
    ctx.egressEngine.invalidateCache();

    const decision = await ctx.egressEngine.evaluate('https://api.example.com/test');
    expect(decision.allowed).toBe(true);
    expect(decision.matched_policy).toBe('high-allow');
  });

  it('invalidating the cache reflects live DB changes', async () => {
    // Initially no allow → blocked
    const before = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(before.allowed).toBe(false);

    // Insert allow policy
    await ctx.store.egressPolicies.create({
      id: 'allow-example',
      name: 'Allow example',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'allowed.example.com',
      priority: 100,
    });
    // Without invalidation, cache still denies (within TTL)
    const cached = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(cached.allowed).toBe(false);

    // After invalidation
    ctx.egressEngine.invalidateCache();
    const after = await ctx.egressEngine.evaluate('https://allowed.example.com');
    expect(after.allowed).toBe(true);
    expect(after.matched_policy).toBe('allow-example');
  });

  it('EgressGate.check throws LoopError when egress is blocked (audit #115)', async () => {
    // No allow policies → default deny
    const gate = new EgressGate(ctx.egressEngine, { airgap: false, unconfiguredPolicy: 'deny', allowPrivate: true });
    await expect(gate.check('https://blocked.example.com/data')).rejects.toThrow(/Egress blocked/);
  });

  // Audit #72: the two tests below exercise the REAL execution path —
  // executor wired with an EgressGate, the real GenericAdapter doing HTTP to
  // a loopback server — instead of asserting engine decisions only.
  it('audit #72: default-deny fails the connector node before any network I/O', async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      ctx.connectors.registerAdapter(new GenericAdapter());
      ctx.connectors.registerInstance('generic-egress', 'generic', { base_url: `http://127.0.0.1:${port}` });
      const gate = new EgressGate(ctx.egressEngine, { airgap: false, unconfiguredPolicy: 'deny', allowPrivate: true });
      const executor = new ExecutionExecutor(ctx.store, ctx.connectors, 5, 5_000, 30_000, undefined, undefined, undefined, gate);

      const definition: WorkflowDefinition = {
        version: '1.0',
        nodes: [createNode('node_1', 'generic.rest_call', { path: '/probe', method: 'GET' })],
        edges: [],
        variables: {},
        metadata: { name: 'egress-deny-flow' },
      };
      await ctx.store.workflows.create({ id: 'wf-egress-deny', name: 'Egress deny', description: '', definition, created_by: 'system' });
      await ctx.store.executions.create({ id: 'exec-egress-deny', workflow_id: 'wf-egress-deny', workflow_version: 1, trigger_type: 'manual', trigger_payload: {} });

      await expect(executor.execute('exec-egress-deny', definition, {})).rejects.toThrow(/Egress blocked/);
      const execution = await ctx.store.executions.getById('exec-egress-deny');
      expect(execution?.status).toBe('failed');
      expect(hits).toHaveLength(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('audit #72: an allow policy lets the same workflow reach the service exactly once', async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await ctx.store.egressPolicies.create({
        id: 'allow-loopback',
        name: 'Allow loopback service',
        rule_type: 'allow',
        target_type: 'domain',
        target_value: '127.0.0.1',
        priority: 100,
      });
      ctx.egressEngine.invalidateCache();

      ctx.connectors.registerAdapter(new GenericAdapter());
      ctx.connectors.registerInstance('generic-egress', 'generic', { base_url: `http://127.0.0.1:${port}` });
      const gate = new EgressGate(ctx.egressEngine, { airgap: false, unconfiguredPolicy: 'deny', allowPrivate: true });
      const executor = new ExecutionExecutor(ctx.store, ctx.connectors, 5, 5_000, 30_000, undefined, undefined, undefined, gate);

      const definition: WorkflowDefinition = {
        version: '1.0',
        nodes: [createNode('node_1', 'generic.rest_call', { path: '/probe', method: 'GET' })],
        edges: [],
        variables: {},
        metadata: { name: 'egress-allow-flow' },
      };
      await ctx.store.workflows.create({ id: 'wf-egress-allow', name: 'Egress allow', description: '', definition, created_by: 'system' });
      await ctx.store.executions.create({ id: 'exec-egress-allow', workflow_id: 'wf-egress-allow', workflow_version: 1, trigger_type: 'manual', trigger_payload: {} });

      await executor.execute('exec-egress-allow', definition, {});
      const execution = await ctx.store.executions.getById('exec-egress-allow');
      expect(execution?.status).toBe('succeeded');
      expect(hits).toEqual(['/probe']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
