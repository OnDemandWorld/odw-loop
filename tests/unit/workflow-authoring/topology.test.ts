import { describe, it, expect } from 'vitest';
import { detectCycle, isReachable, topologicalOrder } from '../../../packages/workflow-authoring/src/topology.js';
import type { WorkflowNode, WorkflowEdge } from '../../../packages/types/src/schemas/workflow.js';

describe('detectCycle', () => {
  it('should return true for cyclic graph', () => {
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
      { id: 'C', type: 'action', position: { x: 200, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'B', source_port: 'output', target: 'C', target_port: 'input', type_compatibility: true },
      { id: 'e3', source: 'C', source_port: 'output', target: 'A', target_port: 'input', type_compatibility: true },
    ];

    expect(detectCycle(nodes, edges)).toBe(true);
  });

  it('should return false for DAG', () => {
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
      { id: 'C', type: 'action', position: { x: 200, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'B', source_port: 'output', target: 'C', target_port: 'input', type_compatibility: true },
    ];

    expect(detectCycle(nodes, edges)).toBe(false);
  });
});

describe('isReachable', () => {
  it('should return true when all nodes reachable', () => {
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
      { id: 'C', type: 'action', position: { x: 200, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'B', source_port: 'output', target: 'C', target_port: 'input', type_compatibility: true },
    ];

    expect(isReachable(nodes, edges)).toBe(true);
  });

  it('should return true when disconnected component has start node', () => {
    // Node C has in-degree 0, so it's considered a start node
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
      { id: 'C', type: 'action', position: { x: 200, y: 100 }, config: {} }, // disconnected but has in-degree 0
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
    ];

    // C is considered reachable because it has in-degree 0 (is a start node)
    expect(isReachable(nodes, edges)).toBe(true);
  });

  it('should return false when node has incoming edges from cycle only', () => {
    // All nodes in cycle have in-degree > 0, so no start nodes
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'B', source_port: 'output', target: 'A', target_port: 'input', type_compatibility: true },
    ];

    // No start nodes (all have incoming edges), so not reachable
    expect(isReachable(nodes, edges)).toBe(false);
  });
});

describe('topologicalOrder', () => {
  it('should produce correct ordering for diamond DAG', () => {
    // Diamond: A -> B, A -> C, B -> D, C -> D
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: -50 }, config: {} },
      { id: 'C', type: 'action', position: { x: 100, y: 50 }, config: {} },
      { id: 'D', type: 'action', position: { x: 200, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'A', source_port: 'output', target: 'C', target_port: 'input', type_compatibility: true },
      { id: 'e3', source: 'B', source_port: 'output', target: 'D', target_port: 'input', type_compatibility: true },
      { id: 'e4', source: 'C', source_port: 'output', target: 'D', target_port: 'input', type_compatibility: true },
    ];

    const order = topologicalOrder(nodes, edges);
    expect(order).toHaveLength(4);
    // A must come before B and C
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    // B and C must come before D
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('should throw on cycle', () => {
    const nodes: WorkflowNode[] = [
      { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
      { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
      { id: 'e2', source: 'B', source_port: 'output', target: 'A', target_port: 'input', type_compatibility: true },
    ];

    expect(() => topologicalOrder(nodes, edges)).toThrow('Circular dependency detected');
  });
});
