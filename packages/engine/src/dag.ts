/**
 * Parse a workflow definition into a DAG structure.
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@loop/types';

export interface DAG {
  nodes: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
  adjacency: Map<string, string[]>;
  reverseAdjacency: Map<string, string[]>;
}

export function parseDAG(definition: WorkflowDefinition): DAG {
  const nodes = new Map<string, WorkflowNode>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const node of definition.nodes) {
    nodes.set(node.id, node);
    adjacency.set(node.id, []);
    reverseAdjacency.set(node.id, []);
  }

  for (const edge of definition.edges) {
    adjacency.get(edge.source)?.push(edge.target);
    reverseAdjacency.get(edge.target)?.push(edge.source);
  }

  return { nodes, edges: definition.edges, adjacency, reverseAdjacency };
}
