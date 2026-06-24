import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../../packages/workflow-authoring/src/validator.js';
import type { WorkflowDefinition } from '../../../packages/types/src/schemas/workflow.js';

describe('validateWorkflow', () => {
  it('should pass for valid workflow with 3 nodes in chain', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'node_2',
          type: 'action',
          position: { x: 100, y: 0 },
          config: {},
        },
        {
          id: 'node_3',
          type: 'action',
          position: { x: 200, y: 0 },
          config: {},
        },
      ],
      edges: [
        {
          id: 'edge_1',
          source: 'node_1',
          source_port: 'output',
          target: 'node_2',
          target_port: 'input',
          type_compatibility: true,
        },
        {
          id: 'edge_2',
          source: 'node_2',
          source_port: 'output',
          target: 'node_3',
          target_port: 'input',
          type_compatibility: true,
        },
      ],
      variables: {},
      metadata: { name: 'Test Workflow', description: 'Test', tags: [] },
    };

    const result = validateWorkflow(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should produce warning but pass for empty workflow', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [],
      edges: [],
      variables: {},
      metadata: { name: 'Empty Workflow', description: 'Empty', tags: [] },
    };

    const result = validateWorkflow(definition);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Workflow has no nodes');
  });

  it('should fail for cycle detection (A→B→C→A)', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'A', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'B', type: 'action', position: { x: 100, y: 0 }, config: {} },
        { id: 'C', type: 'action', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'A', source_port: 'output', target: 'B', target_port: 'input', type_compatibility: true },
        { id: 'e2', source: 'B', source_port: 'output', target: 'C', target_port: 'input', type_compatibility: true },
        { id: 'e3', source: 'C', source_port: 'output', target: 'A', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Cyclic Workflow', description: 'Has cycle', tags: [] },
    };

    const result = validateWorkflow(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Circular dependency'))).toBe(true);
  });

  it('should pass when all nodes have paths from start nodes', () => {
    // Note: nodes with in-degree 0 are considered start nodes
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'trigger', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
        { id: 'node_3', type: 'action', position: { x: 300, y: 100 }, config: {} }, // disconnected but has in-degree 0
      ],
      edges: [
        { id: 'edge_1', source: 'node_1', source_port: 'output', target: 'node_2', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Connected Workflow', description: 'All nodes reachable', tags: [] },
    };

    const result = validateWorkflow(definition);
    // node_3 has in-degree 0, so it's considered a start node and thus reachable
    expect(result.valid).toBe(true);
    expect(result.errors.some(e => e.includes('Orphan nodes detected'))).toBe(false);
  });

  it('should fail when edge references unknown node', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'edge_1', source: 'node_1', source_port: 'output', target: 'node_unknown', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Unknown Node Workflow', description: 'Unknown target', tags: [] },
    };

    const result = validateWorkflow(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unknown target node'))).toBe(true);
  });

  it('should detect duplicate node IDs', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_1', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Duplicate ID Workflow', description: 'Duplicate IDs', tags: [] },
    };

    const result = validateWorkflow(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate node ID'))).toBe(true);
  });

  it('should warn for terminal nodes with no outgoing edges', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'trigger', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
        { id: 'node_3', type: 'action', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'edge_1', source: 'node_1', source_port: 'output', target: 'node_2', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Terminal Nodes Workflow', description: 'Has terminal nodes', tags: [] },
    };

    const result = validateWorkflow(definition);
    // node_2 and node_3 both have no outgoing edges (terminal nodes)
    expect(result.valid).toBe(true); // Valid but with warnings
    expect(result.warnings.some(w => w.includes('no outgoing edges'))).toBe(true);
  });
});
