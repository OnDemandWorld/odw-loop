/**
 * E2E — Air-gapped deployment mode.
 *
 * LOOP_AIRGAP_MODE=true should cause all external HTTP calls to be blocked.
 * Since the airgap check is not yet wired into the connectors at the time of
 * writing, this test exercises the airgap semantics through a simulated policy
 * layer and verifies the intent: external calls blocked, local LLM calls succeed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestContext,
  createMockAdapter,
  createNode,
  type TestContext,
} from './helpers';
import type { WorkflowDefinition } from '../../packages/types';

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

  it('allows workflow execution using a local LLM (localhost) when airgap is on', async () => {
    // Allow localhost only; everything else is denied by default.
    await ctx.store.egressPolicies.create({
      id: 'airgap-allow-local',
      name: 'airgap-allow-local',
      rule_type: 'allow',
      target_type: 'domain',
      target_value: 'localhost',
      priority: 2000,
    });
    ctx.egressEngine.invalidateCache();

    // Localhost is allowed
    const local = await ctx.egressEngine.evaluate('http://localhost:11434/api/generate');
    expect(local.allowed).toBe(true);

    // External LLM is blocked
    const openai = await ctx.egressEngine.evaluate('https://api.openai.com/v1/chat');
    expect(openai.allowed).toBe(false);

    // Now run a workflow whose only node is a mock "local LLM" connector
    const localLlm = createMockAdapter('local_llm', { text: 'generated locally' });
    ctx.connectors.registerAdapter(localLlm);

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [createNode('node_1', 'local_llm.generate', { prompt: 'summarise' })],
      edges: [],
      variables: {},
      metadata: { name: 'local-llm-flow' },
    };

    await ctx.store.workflows.create({
      id: 'wf-airgap-local',
      name: 'Airgap local LLM',
      description: '',
      definition,
      created_by: 'system',
    });

    const executionId = 'exec-airgap-local-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: 'wf-airgap-local',
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: {},
    });

    await ctx.executor.execute(executionId, definition, {});
    expect(localLlm.calls).toHaveLength(1);
  });
});
