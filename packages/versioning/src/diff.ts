/**
 * Diff two workflow definitions and produce a human-readable change summary.
 */

import type { WorkflowDefinition } from '@loop/types';

export interface DiffResult {
  nodes_added: string[];
  nodes_removed: string[];
  nodes_modified: string[];
  edges_added: string[];
  edges_removed: string[];
  summary: string;
}

export function diffDefinitions(
  from: WorkflowDefinition,
  to: WorkflowDefinition,
): DiffResult {
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));

  const nodes_added: string[] = [];
  const nodes_removed: string[] = [];
  const nodes_modified: string[] = [];

  for (const [id] of toNodes) {
    if (!fromNodes.has(id)) nodes_added.push(id);
  }
  for (const [id] of fromNodes) {
    if (!toNodes.has(id)) nodes_removed.push(id);
  }
  for (const [id, toNode] of toNodes) {
    const fromNode = fromNodes.get(id);
    if (fromNode && JSON.stringify(fromNode) !== JSON.stringify(toNode)) {
      nodes_modified.push(id);
    }
  }

  const fromEdges = new Map(from.edges.map((e) => [e.id, e]));
  const toEdges = new Map(to.edges.map((e) => [e.id, e]));

  const edges_added: string[] = [];
  const edges_removed: string[] = [];

  for (const [id] of toEdges) {
    if (!fromEdges.has(id)) edges_added.push(id);
  }
  for (const [id] of fromEdges) {
    if (!toEdges.has(id)) edges_removed.push(id);
  }

  const parts: string[] = [];
  if (nodes_added.length) parts.push(`+${nodes_added.length} nodes`);
  if (nodes_removed.length) parts.push(`-${nodes_removed.length} nodes`);
  if (nodes_modified.length) parts.push(`~${nodes_modified.length} nodes`);
  if (edges_added.length) parts.push(`+${edges_added.length} edges`);
  if (edges_removed.length) parts.push(`-${edges_removed.length} edges`);
  const summary = parts.length ? parts.join(', ') : 'no changes';

  return { nodes_added, nodes_removed, nodes_modified, edges_added, edges_removed, summary };
}
