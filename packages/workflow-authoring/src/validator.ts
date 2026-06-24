/**
 * Workflow topology validation — implements the 6 rules from TSD §6.6.
 */

import type { WorkflowDefinition } from '@loop/types';
import { detectCycle, isReachable } from './topology.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWorkflow(definition: WorkflowDefinition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { nodes, edges } = definition;

  if (nodes.length === 0) {
    // Empty workflow is technically valid but worth a warning
    warnings.push('Workflow has no nodes');
    return { valid: true, errors, warnings };
  }

  // Rule 1: No orphan nodes — every node must be reachable from a start node
  if (!isReachable(nodes, edges)) {
    errors.push('Orphan nodes detected: not all nodes are reachable from a start node');
  }

  // Rule 2: No cycles — DAG must be acyclic
  if (detectCycle(nodes, edges)) {
    errors.push('Circular dependency detected: workflow graph must be a DAG');
  }

  // Rule 3: Port compatibility — edges should have compatible types
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    if (!nodeMap.has(edge.source)) {
      errors.push(`Edge '${edge.id}' references unknown source node '${edge.source}'`);
    }
    if (!nodeMap.has(edge.target)) {
      errors.push(`Edge '${edge.id}' references unknown target node '${edge.target}'`);
    }
    if (edge.type_compatibility === false) {
      errors.push(`Edge '${edge.id}' has incompatible port types`);
    }
  }

  // Rule 4: Required config — nodes with config schemas should have required fields
  // (This would require connector-specific config schemas; for now we skip deep validation)

  // Rule 5: Variable references — check {{variable}} syntax
  for (const node of nodes) {
    const configStr = JSON.stringify(node.config);
    const varRefs = configStr.match(/\{\{([^}]+)\}\}/g);
    if (varRefs) {
      for (const ref of varRefs) {
        const varName = ref.slice(2, -2).trim();
        // Valid patterns: trigger.payload.*, node_N.output.*, or workflow variables
        if (!varName.startsWith('trigger.') && !varName.match(/^node_\w+\.output\./) && !definition.variables[varName]) {
          warnings.push(`Node '${node.id}': variable reference '${varName}' may not resolve`);
        }
      }
    }
  }

  // Rule 6: Trigger exists — active workflows need at least one trigger
  // (This is checked at the service level, not here, since triggers are separate entities)

  // Additional checks
  const nodeIds = new Set(nodes.map((n) => n.id));
  const duplicateIds = nodes.length - nodeIds.size;
  if (duplicateIds > 0) {
    errors.push(`${duplicateIds} duplicate node ID(s) detected`);
  }

  // Nodes with no outgoing edges (except if they're the only node)
  if (nodes.length > 1) {
    const nodesWithOutgoing = new Set(edges.map((e) => e.source));
    const terminalNodes = nodes.filter((n) => !nodesWithOutgoing.has(n.id));
    if (terminalNodes.length > 0) {
      for (const tn of terminalNodes) {
        warnings.push(`Node '${tn.id}' has no outgoing edges`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
