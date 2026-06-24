/**
 * Topological sort (Kahn's algorithm) + level-based scheduling (§6.2).
 * Nodes at the same topological level can execute in parallel.
 */

import type { WorkflowNode, WorkflowEdge } from '@loop/types';
import { ValidationError } from '@loop/types';

export interface ExecutionPlan {
  /** Nodes in topological order. */
  sortedNodes: WorkflowNode[];
  /** Nodes grouped by execution level (same level = can run in parallel). */
  levels: WorkflowNode[][];
}

/** Topological sort using Kahn's algorithm. Throws WorkflowValidationError on cycle. */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new ValidationError('Circular dependency detected in workflow');
  }

  return sorted.map((id) => nodeMap.get(id)!);
}

/** Group nodes by topological level for parallel execution. */
export function computeLevels(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[][] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const levels: WorkflowNode[][] = [];
  let currentLevel = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);

  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    const nextLevel: WorkflowNode[] = [];
    for (const node of currentLevel) {
      for (const neighbor of adjacency.get(node.id) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          const neighborNode = nodeMap.get(neighbor);
          if (neighborNode) nextLevel.push(neighborNode);
        }
      }
    }
    currentLevel = nextLevel;
  }

  return levels;
}

/** Build a full execution plan with sorted order and parallel levels. */
export function buildExecutionPlan(nodes: WorkflowNode[], edges: WorkflowEdge[]): ExecutionPlan {
  return {
    sortedNodes: topologicalSort(nodes, edges),
    levels: computeLevels(nodes, edges),
  };
}
