import { describe, it, expect } from 'vitest';
import { topologicalSort, computeLevels } from '../../../packages/engine/src/scheduler';
import { ValidationError } from '../../../packages/types/src/errors';
import type { WorkflowNode, WorkflowEdge } from '../../../packages/types/src/schemas/workflow';

function createNode(id: string): WorkflowNode {
  return {
    id,
    type: 'test',
    position: { x: 0, y: 0 },
    config: {},
  };
}

function createEdge(source: string, target: string): WorkflowEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    source_port: 'output',
    target_port: 'input',
    type_compatibility: true,
  };
}

describe('topologicalSort', () => {
  it('should sort diamond DAG correctly (A→B, A→C, B→D, C→D)', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C'), createNode('D')];
    const edges = [
      createEdge('A', 'B'),
      createEdge('A', 'C'),
      createEdge('B', 'D'),
      createEdge('C', 'D'),
    ];

    const sorted = topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    // A must come before B and C
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
    // B and C must come before D
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
    expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
    // All nodes present
    expect(sorted).toHaveLength(4);
  });

  it('should throw ValidationError on cycle detection', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C')];
    const edges = [createEdge('A', 'B'), createEdge('B', 'C'), createEdge('C', 'A')];

    try {
      topologicalSort(nodes, edges);
      expect.fail('Should have thrown ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Circular dependency detected/);
      expect((err as Error).name).toBe('ValidationError');
    }
  });

  it('should return empty array for empty workflow', () => {
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];

    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toEqual([]);
    expect(sorted).toHaveLength(0);
  });

  it('should handle linear chain (A→B→C→D)', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C'), createNode('D')];
    const edges = [createEdge('A', 'B'), createEdge('B', 'C'), createEdge('C', 'D')];

    const sorted = topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    expect(ids).toEqual(['A', 'B', 'C', 'D']);
  });

  it('should handle disconnected nodes', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C')];
    const edges: WorkflowEdge[] = [];

    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toHaveLength(3);
    expect(sorted.map((n) => n.id)).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });
});

describe('computeLevels', () => {
  it('should group nodes by execution level for parallel execution', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C'), createNode('D')];
    const edges = [
      createEdge('A', 'B'),
      createEdge('A', 'C'),
      createEdge('B', 'D'),
      createEdge('C', 'D'),
    ];

    const levels = computeLevels(nodes, edges);

    // Level 0: A (no dependencies)
    expect(levels[0]).toHaveLength(1);
    expect(levels[0][0].id).toBe('A');

    // Level 1: B and C (can run in parallel)
    expect(levels[1]).toHaveLength(2);
    const level1Ids = levels[1].map((n) => n.id);
    expect(level1Ids).toContain('B');
    expect(level1Ids).toContain('C');

    // Level 2: D (depends on B and C)
    expect(levels[2]).toHaveLength(1);
    expect(levels[2][0].id).toBe('D');
  });

  it('should return empty array for empty workflow', () => {
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];

    const levels = computeLevels(nodes, edges);
    expect(levels).toEqual([]);
  });

  it('should handle linear chain as separate levels', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C')];
    const edges = [createEdge('A', 'B'), createEdge('B', 'C')];

    const levels = computeLevels(nodes, edges);

    expect(levels).toHaveLength(3);
    expect(levels[0][0].id).toBe('A');
    expect(levels[1][0].id).toBe('B');
    expect(levels[2][0].id).toBe('C');
  });

  it('should handle all independent nodes in one level', () => {
    const nodes = [createNode('A'), createNode('B'), createNode('C')];
    const edges: WorkflowEdge[] = [];

    const levels = computeLevels(nodes, edges);

    expect(levels).toHaveLength(1);
    expect(levels[0]).toHaveLength(3);
  });
});

describe('Performance test', () => {
  it('should handle 200-node DAG in less than 50ms', () => {
    // Create a complex DAG with 200 nodes
    const nodes: WorkflowNode[] = [];
    const edges: WorkflowEdge[] = [];

    for (let i = 0; i < 200; i++) {
      nodes.push(createNode(`node-${i}`));
    }

    // Create a realistic DAG structure
    for (let i = 0; i < 199; i++) {
      edges.push(createEdge(`node-${i}`, `node-${i + 1}`));
    }

    const start = Date.now();
    const sorted = topologicalSort(nodes, edges);
    const duration = Date.now() - start;

    expect(sorted).toHaveLength(200);
    expect(duration).toBeLessThan(50);
  });
});
