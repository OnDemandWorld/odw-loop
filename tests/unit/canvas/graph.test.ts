/**
 * Unit tests — canvas graph helpers (audit #2, #3).
 *
 * #2: node ids must not collide after delete+add or on non-contiguous graphs.
 * #3: saving must preserve node/edge fields the canvas does not edit
 *     (retry, timeout_ms, schemas, type_compatibility) and workflow settings.
 */

import { describe, it, expect } from 'vitest';
import type { Node, Edge } from 'reactflow';
import { nextNodeId, buildDefinitionFromGraph } from '../../../apps/canvas/src/lib/graph';
import type { WorkflowDefinition } from '../../../apps/canvas/src/lib/api';

describe('nextNodeId (audit #2)', () => {
  it('starts at node_1 for an empty graph', () => {
    expect(nextNodeId([])).toBe('node_1');
  });

  it('uses max existing suffix + 1, not count + 1 (delete+add case)', () => {
    // node_2 was deleted from node_1..node_5: count=4 but node_5 still exists.
    expect(nextNodeId(['node_1', 'node_3', 'node_4', 'node_5'])).toBe('node_6');
  });

  it('ignores non node_N ids without colliding', () => {
    expect(nextNodeId(['n_src', 'n_branch'])).toBe('node_1');
    expect(nextNodeId(['node_1', 'fetch'])).toBe('node_2');
  });

  it('never returns an id already present', () => {
    const ids = ['node_1', 'node_2', 'node_7', 'custom'];
    expect(ids).not.toContain(nextNodeId(ids));
  });
});

describe('buildDefinitionFromGraph (audit #3)', () => {
  const base: WorkflowDefinition = {
    version: '1.0',
    nodes: [
      {
        id: 'node_1',
        type: 'vault.search',
        position: { x: 0, y: 0 },
        config: { query: 'old' },
        retry: { max_attempts: 3, backoff: 'exponential', initial_delay_ms: 500 },
        timeout_ms: 12_000,
      },
    ],
    edges: [{ id: 'e1', source: 'node_1', target: 'node_2' }],
    variables: { recipient: 'ops@example.test' },
    metadata: { name: 'invoice-approval', description: 'd', tags: ['finance'] },
    settings: { workflow_timeout_ms: 600_000 },
  };

  function rfNode(original?: Record<string, unknown>): Node {
    return {
      id: 'node_1',
      type: 'connector',
      position: { x: 10.4, y: 20.6 },
      data: {
        connectorType: 'vault',
        operation: 'search',
        config: { query: 'new' },
        ...(original ? { original } : {}),
      },
    } as Node;
  }

  it('preserves retry/timeout_ms and settings while applying edited config/position', () => {
    const nodes = [rfNode(base.nodes[0] as unknown as Record<string, unknown>)];
    const edges = [
      {
        id: 'e1',
        source: 'node_1',
        target: 'node_2',
        data: { original: { ...base.edges[0], type_compatibility: false } },
      } as Edge,
    ];
    const out = buildDefinitionFromGraph(nodes, edges, base, 'fallback');
    expect(out.nodes[0]!.config).toEqual({ query: 'new' });
    expect(out.nodes[0]!.position).toEqual({ x: 10, y: 21 });
    expect(out.nodes[0]!.retry).toEqual({ max_attempts: 3, backoff: 'exponential', initial_delay_ms: 500 });
    expect(out.nodes[0]!.timeout_ms).toBe(12_000);
    expect((out.edges[0] as unknown as { type_compatibility: boolean }).type_compatibility).toBe(false);
    expect(out.settings).toEqual({ workflow_timeout_ms: 600_000 });
    expect(out.variables).toEqual(base.variables);
    expect(out.metadata).toEqual(base.metadata);
  });

  it('new nodes without an original still produce valid plain nodes', () => {
    const out = buildDefinitionFromGraph([rfNode()], [], undefined, 'my workflow');
    expect(out.nodes[0]).toEqual({
      id: 'node_1',
      type: 'vault.search',
      position: { x: 10, y: 21 },
      config: { query: 'new' },
    });
    expect(out.settings).toBeUndefined();
    expect(out.metadata.name).toBe('my workflow');
  });
});

describe('sourcePortsByNode (audit #24)', () => {
  it('collects named outgoing ports per source node', async () => {
    const { sourcePortsByNode } = await import('../../../apps/canvas/src/lib/graph');
    const edges = [
      { id: 'e1', source: 'cond', target: 'a', sourceHandle: 'auto_approve' },
      { id: 'e2', source: 'cond', target: 'b', sourceHandle: 'needs_review' },
      { id: 'e3', source: 'cond', target: 'c', sourceHandle: 'auto_approve' },
      { id: 'e4', source: 'plain', target: 'd' },
    ] as Edge[];
    expect(sourcePortsByNode(edges)).toEqual({ cond: ['auto_approve', 'needs_review'] });
  });
});
