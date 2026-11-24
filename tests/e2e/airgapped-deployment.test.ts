/**
 * E2E — Air-gapped deployment mode.
 *
 * LOOP_AIRGAP_MODE=true must block ALL outbound HTTP on the workflow execution
 * path. Audit #13: these tests now wire a real EgressGate({airgap}) into the
 * executor and drive a REAL GenericAdapter against a loopback HTTP server, so
 * a dropped gate wiring or an adapter ignoring params.egress fails the suite.
 * The engine-level policy test is retained as a complement.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


import { EgressGate } from '../../packages/egress/src';
import { GenericAdapter } from '../../packages/connectors/src';
import { ExecutionExecutor } from '../../packages/engine/src';
import type { WorkflowDefinition } from '../../packages/types';

import {
  createTestContext,
  createNode,
  type TestContext,
} from './helpers';

describe('Air-gapped deployment mode (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('blocks all external HTTP calls when airgap is enabled', async () => {
    // Insert a high-priority deny-all rule that mimics airgap mode.
    // The EgressEngine's default policy is "deny" when nothing matches, so
    // airgap is enforced by: (a) no allow rules for external domains, and
    // (b) default deny. We verify this by asserting every external URL is
    // denied by default when no allow policies exist.
    //
    // Additionally, we add explicit deny rules for major external providers
    // to demonstrate that even if an IP/range were guessed, the engine would
    // still reject them.
    await ctx.store.egressPolicies.create({
      id: 'airgap-deny-openai',
      name: 'airgap-deny-openai',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.openai.com',
      priority: 1000,
    });
    await ctx.store.egressPolicies.create({
      id: 'airgap-deny-anthropic',
      name: 'airgap-deny-anthropic',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.anthropic.com',
      priority: 1000,
    });
    await ctx.store.egressPolicies.create({
      id: 'airgap-deny-google',
      name: 'airgap-deny-google',
      rule_type: 'deny',
      target_type: 'domain',
      target_value: '*.google.com',
      priority: 1000,
    });
    ctx.egressEngine.invalidateCache();

    // Verify the egress engine blocks typical external calls — either by
    // explicit deny rule or by default deny (no matching allow policy).
    const openai = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(openai.allowed).toBe(false);

    const google = await ctx.egressEngine.evaluate('https://google.com');
    expect(google.allowed).toBe(false);

    const unknownExternal = await ctx.egressEngine.evaluate('https://random-service.example.com');
    expect(unknownExternal.allowed).toBe(false);
  });

  it('audit #13: airgap gate on the executor blocks a real connector HTTP call', async () => {
    // Loopback HTTP server standing in for an external service.
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '/');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    try {
      // Real adapter (real undici HTTP), real gate with airgap enabled.
      ctx.connectors.registerAdapter(new GenericAdapter());
      const gate = new EgressGate(ctx.egressEngine, {
        airgap: true,
        unconfiguredPolicy: 'allow',
        allowPrivate: true,
      });
      const executor = new ExecutionExecutor(
        ctx.store, ctx.connectors, 5, 5_000, 30_000, undefined, undefined, undefined, gate,
      );

      const definition: WorkflowDefinition = {
        version: '1.0',
        nodes: [createNode('node_1', 'generic.rest_call', { path: '/probe', method: 'GET' })],
        edges: [],
        variables: {},
        metadata: { name: 'airgap-blocked-flow' },
      };
      await ctx.store.workflows.create({
        id: 'wf-airgap-blocked',
        name: 'Airgap blocked',
        description: '',
        definition,
        created_by: 'system',
      });
      // Instance config carries the base URL the adapter will target.
      ctx.connectors.registerInstance('generic-airgap', 'generic', {
        base_url: `http://127.0.0.1:${port}`,
      });
      const executionId = 'exec-airgap-blocked-1';
      await ctx.store.executions.create({
        id: executionId,
        workflow_id: 'wf-airgap-blocked',
        workflow_version: 1,
        trigger_type: 'manual',
        trigger_payload: {},
      });

      await expect(executor.execute(executionId, definition, {})).rejects.toThrow(/Airgap|NODE_EGRESS_BLOCKED/);
      const execution = await ctx.store.executions.getById(executionId);
      expect(execution?.status).toBe('failed');
      // The gate must stop the call BEFORE any network I/O.
      expect(hits).toHaveLength(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('audit #13: with airgap off the same workflow reaches the loopback service', async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '/');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;

    try {
      ctx.connectors.registerAdapter(new GenericAdapter());
      const gate = new EgressGate(ctx.egressEngine, {
        airgap: false,
        unconfiguredPolicy: 'allow',
        allowPrivate: true, // self-hosted suite on a trusted private network
      });
      const executor = new ExecutionExecutor(
        ctx.store, ctx.connectors, 5, 5_000, 30_000, undefined, undefined, undefined, gate,
      );

      const definition: WorkflowDefinition = {
        version: '1.0',
        nodes: [createNode('node_1', 'generic.rest_call', { path: '/probe', method: 'GET' })],
        edges: [],
        variables: {},
        metadata: { name: 'airgap-off-flow' },
      };
      await ctx.store.workflows.create({
        id: 'wf-airgap-off',
        name: 'Airgap off',
        description: '',
        definition,
        created_by: 'system',
      });
      ctx.connectors.registerInstance('generic-open', 'generic', {
        base_url: `http://127.0.0.1:${port}`,
      });
      const executionId = 'exec-airgap-off-1';
      await ctx.store.executions.create({
        id: executionId,
        workflow_id: 'wf-airgap-off',
        workflow_version: 1,
        trigger_type: 'manual',
        trigger_payload: {},
      });

      await executor.execute(executionId, definition, {});
      const execution = await ctx.store.executions.getById(executionId);
      expect(execution?.status).toBe('succeeded');
      expect(hits).toEqual(['/probe']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
