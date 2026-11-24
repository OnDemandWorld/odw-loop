/**
 * Pure graph helpers shared by the workflow editor (audit #2, #3).
 *
 * - nextNodeId: collision-free node ids derived from the EXISTING ids, not
 *   nodes.length (delete+add used to reuse an id and make the graph unsavable).
 * - buildDefinitionFromGraph: reconstructs the workflow definition while
 *   PRESERVING fields the canvas does not edit (retry, timeout_ms, schemas,
 *   edge.type_compatibility, workflow settings) via the original objects
 *   stashed in node/edge data at load time.
 */

import type { Node, Edge } from 'reactflow';
import type { WorkflowDefinition } from './api';

/** Next free `node_N` id given the ids currently in the graph. */
export function nextNodeId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^node_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `node_${max + 1}`;
}

/**
 * Named outgoing ports per source node, derived from the edge list (audit #24).
 * Control nodes other than `branch` (e.g. control.condition) route through
 * named ports; without a handle per port React Flow drops those edges from
 * rendering and the graph looks disconnected.
 */
export function sourcePortsByNode(edges: Edge[]): Record<string, string[]> {
  const ports: Record<string, string[]> = {};
  for (const e of edges) {
    const port = e.sourceHandle;
    if (!port) continue;
    const list = (ports[e.source] ??= []);
    if (!list.includes(port)) list.push(port);
  }
  return ports;
}

/** Reconstruct the full dotted node type (e.g. `vault.search`) from RF node data. */
export function fullNodeType(node: Node): string {
  return node.type === 'control'
    ? `control.${node.data.controlType}`
    : node.type === 'code'
      ? `code.${node.data.language ?? 'typescript'}`
      : `${node.data.connectorType}.${node.data.operation}`;
}

/**
 * Build a WorkflowDefinition from the live React Flow graph. `base` is the
 * loaded server definition (source of version/variables/metadata/settings);
 * each node/edge carries its original object in `data.original` so unedited
 * fields survive the round-trip.
 */
export function buildDefinitionFromGraph(
  nodes: Node[],
  edges: Edge[],
  base: WorkflowDefinition | undefined,
  fallbackName: string,
): WorkflowDefinition {
  return {
    version: base?.version ?? '1.0',
    nodes: nodes.map((n) => ({
      ...(n.data?.original as Partial<WorkflowDefinition['nodes'][number]> | undefined),
      id: n.id,
      type: fullNodeType(n),
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: (n.data?.config ?? {}) as Record<string, unknown>,
    })),
    edges: edges.map((e) => ({
      ...(e.data?.original as Partial<WorkflowDefinition['edges'][number]> | undefined),
      id: e.id,
      source: e.source,
      source_port: e.sourceHandle ?? 'output',
      target: e.target,
      target_port: e.targetHandle ?? 'input',
    })),
    variables: base?.variables ?? {},
    metadata: base?.metadata ?? { name: fallbackName, description: '', tags: [] },
    ...(base?.settings ? { settings: base.settings } : {}),
  };
}
