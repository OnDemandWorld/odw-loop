/**
 * Graph operations for workflow topology validation.
 */

import type { WorkflowNode, WorkflowEdge } from '@loop/types';

/** Detect cycles using DFS. Returns true if the graph has a cycle. */
export function detectCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const adj = buildAdjacency(nodes, edges);
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (stack.has(nodeId)) return true; // cycle
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    stack.add(nodeId);
    for (const neighbor of adj.get(nodeId) ?? []) {
      if (dfs(neighbor)) return true;
    }
    stack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (dfs(node.id)) return true;
  }
  return false;
}

/** Check if all nodes are reachable from the first node (or any start node). */
export function isReachable(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  if (nodes.length === 0) return true;

  const adj = buildAdjacency(nodes, edges);
  const visited = new Set<string>();

  // Start from nodes with in-degree 0 (no incoming edges)
  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node.id, 0);
  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const startNodes = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);

  // If no start nodes (all have incoming edges), that's a cycle
  if (startNodes.length === 0) return false;

  // BFS from all start nodes
  const queue = [...startNodes.map((n) => n.id)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adj.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return visited.size === nodes.length;
}

/** Topological ordering via Kahn's algorithm. */
export function topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
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
    for (const neighbor of adj.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Circular dependency detected');
  }
  return sorted;
}

function buildAdjacency(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node.id, []);
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
  }
  return adj;
}
