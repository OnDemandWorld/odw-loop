/**
 * Integration tests — Vault connector.
 *
 * Replaces the real VaultAdapter with a mock implementation so we can assert
 * the executor dispatches the correct operation with the correct parameters.
 * The mock records every call so tests can verify the call chain end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ConnectorAdapter, ExecuteParams, ExecuteResult } from '../../../packages/connectors/src/interface.js';
import {
  buildTestApp,
  seedWorkflow,
  type TestApp,
} from '../_helpers/app.js';
import type { WorkflowDefinition } from '../../../packages/types/src/index.js';

interface RecordedCall {
  operation: string;
  input: Record<string, unknown>;
  config: Record<string, unknown> | undefined;
}

class MockVaultAdapter implements ConnectorAdapter {
  readonly type = 'vault';
  readonly calls: RecordedCall[] = [];
  private responseFactory: (operation: string, input: Record<string, unknown>) => Record<string, unknown>;

  constructor(
    responseFactory?: (operation: string, input: Record<string, unknown>) => Record<string, unknown>,
  ) {
    this.responseFactory = responseFactory ?? ((op, inp) => ({ mock: true, operation: op, echo: inp }));
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    this.calls.push({
      operation: params.operation,
      input: params.input,
      config: params.config as Record<string, unknown> | undefined,
    });
    return { output: this.responseFactory(params.operation, params.input) };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  getCapabilities() {
    return {
      node_types: [
        'vault.search',
        'vault.create_document',
        'vault.update_document',
        'vault.delete_document',
        'vault.rag_query',
        'vault.manage_tags',
      ],
      input_types: ['Document', 'string'],
      output_types: ['Document', 'Document[]'],
    };
  }
}

describe('Vault connector integration', () => {
  let ctx: TestApp;
  let mockVault: MockVaultAdapter;

  beforeAll(async () => {
    ctx = await buildTestApp();
    mockVault = new MockVaultAdapter();
    // Replace the real vault adapter with the mock
    ctx.connectors.registerAdapter(mockVault);

    // Register a connector instance so the executor finds a config
    ctx.connectors.registerInstance('vault-default', 'vault', {
      base_url: 'http://mock-vault.test',
    });

    await ctx.app.ready();
  });

  afterAll(async () => {
    await ctx.app.close();
    ctx.conn.close();
  });

  it('executes vault.search node and stores the output', async () => {
    mockVault.calls.length = 0;
    mockVault.responseFactory = () => ({
      documents: [
        { id: 'd1', title: 'Document One' },
        { id: 'd2', title: 'Document Two' },
      ],
    });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'n1',
          type: 'vault.search',
          position: { x: 0, y: 0 },
          config: { query: 'test query', limit: 10 },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'vault-search-test' },
    };

    const wf = await seedWorkflow(ctx.store, { definition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, definition, {});

    // Verify the adapter was called
    expect(mockVault.calls).toHaveLength(1);
    expect(mockVault.calls[0].operation).toBe('search');
    expect(mockVault.calls[0].input).toMatchObject({ query: 'test query', limit: 10 });
    // Instance config should be passed through
    expect(mockVault.calls[0].config).toMatchObject({ base_url: 'http://mock-vault.test' });

    // Verify output stored in DB
    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe('succeeded');
    expect(nodes[0].output).toMatchObject({
      documents: [
        { id: 'd1', title: 'Document One' },
        { id: 'd2', title: 'Document Two' },
      ],
    });
  });

  it('executes vault.create_document node', async () => {
    mockVault.calls.length = 0;
    mockVault.responseFactory = () => ({ id: 'new-doc', created: true });

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'n1',
          type: 'vault.create_document',
          position: { x: 0, y: 0 },
          config: { title: 'New Doc', content: 'Hello world' },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'vault-create-test' },
    };

    const wf = await seedWorkflow(ctx.store, { definition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, definition, {});

    expect(mockVault.calls).toHaveLength(1);
    expect(mockVault.calls[0].operation).toBe('create_document');
    expect(mockVault.calls[0].input).toMatchObject({
      title: 'New Doc',
      content: 'Hello world',
    });

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes[0].output).toMatchObject({ id: 'new-doc', created: true });
  });

  it('chains vault.search → vault.create_document with variable interpolation', async () => {
    mockVault.calls.length = 0;
    let callCount = 0;
    mockVault.responseFactory = (op) => {
      callCount++;
      if (op === 'search') {
        return { results: [{ id: 'x', title: 'Found' }], count: 1 };
      }
      return { success: true };
    };

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          // Node ids must be named 'node_<suffix>' so the variable
          // interpolation regex (`node_\w+.output.*`) can reference them.
          id: 'node_search',
          type: 'vault.search',
          position: { x: 0, y: 0 },
          config: { query: 'initial search' },
        },
        {
          id: 'node_create',
          type: 'vault.create_document',
          position: { x: 200, y: 0 },
          config: { title: 'Derived from search', ref: '{{node_search.output.count}}' },
        },
      ],
      edges: [{ id: 'e', source: 'node_search', target: 'node_create' }],
      variables: {},
      metadata: { name: 'vault-chain-test' },
    };

    const wf = await seedWorkflow(ctx.store, { definition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await ctx.executor.execute(executionId, definition, {});

    expect(mockVault.calls).toHaveLength(2);
    expect(mockVault.calls[0].operation).toBe('search');
    expect(mockVault.calls[1].operation).toBe('create_document');
    // Variable interpolation should have replaced {{node_search.output.count}}
    expect(mockVault.calls[1].input['ref']).toBe('1');

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.status === 'succeeded')).toBe(true);
  });

  it('propagates upstream errors when vault is unavailable', async () => {
    mockVault.calls.length = 0;
    mockVault.responseFactory = () => {
      throw new Error('Upstream Vault unavailable: ECONNREFUSED');
    };

    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'n1',
          type: 'vault.search',
          position: { x: 0, y: 0 },
          config: { query: 'anything' },
          retry: { max_attempts: 0, backoff: 'fixed', initial_delay_ms: 0 },
        },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'vault-error-test' },
    };

    const wf = await seedWorkflow(ctx.store, { definition });
    const executionId = crypto.randomUUID();
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: wf.id,
      workflow_version: 1,
      trigger_type: 'manual',
    });

    await expect(ctx.executor.execute(executionId, definition, {})).rejects.toThrow(
      /Vault unavailable/,
    );

    const nodes = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe('failed');
    expect(nodes[0].error).toMatch(/Vault unavailable/);
  });

  it('vault adapter advertises the correct capabilities', () => {
    const caps = mockVault.getCapabilities();
    expect(caps.node_types).toContain('vault.search');
    expect(caps.node_types).toContain('vault.create_document');
    expect(caps.node_types).toContain('vault.rag_query');
    expect(caps.input_types).toContain('Document');
    expect(caps.output_types).toContain('Document[]');
  });
});
