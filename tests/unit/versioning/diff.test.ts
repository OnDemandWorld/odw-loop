import { describe, it, expect } from 'vitest';
import { diffDefinitions } from '../../../packages/versioning/src/diff.js';
import type { WorkflowDefinition } from '../../../packages/types/src/schemas/workflow.js';

describe('diffDefinitions', () => {
  it('should detect nodes added', () => {
    const from: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const to: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(from, to);
    expect(diff.nodes_added).toContain('node_2');
    expect(diff.nodes_removed).toHaveLength(0);
    expect(diff.nodes_modified).toHaveLength(0);
  });

  it('should detect nodes removed', () => {
    const from: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const to: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(from, to);
    expect(diff.nodes_removed).toContain('node_2');
    expect(diff.nodes_added).toHaveLength(0);
  });

  it('should detect nodes modified', () => {
    const from: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: { value: 1 } },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const to: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: { value: 2 } },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(from, to);
    expect(diff.nodes_modified).toContain('node_1');
    expect(diff.nodes_added).toHaveLength(0);
    expect(diff.nodes_removed).toHaveLength(0);
  });

  it('should detect edges added and removed', () => {
    const from: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'edge_1', source: 'node_1', source_port: 'output', target: 'node_2', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const to: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'edge_2', source: 'node_2', source_port: 'output', target: 'node_1', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(from, to);
    expect(diff.edges_added).toContain('edge_2');
    expect(diff.edges_removed).toContain('edge_1');
  });

  it('should generate summary string', () => {
    const from: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const to: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
        { id: 'node_2', type: 'action', position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'edge_1', source: 'node_1', source_port: 'output', target: 'node_2', target_port: 'input', type_compatibility: true },
      ],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(from, to);
    expect(diff.summary).toContain('+1 nodes');
    expect(diff.summary).toContain('+1 edges');
  });

  it('should return empty diff for no changes', () => {
    const definition: WorkflowDefinition = {
      version: '1.0',
      nodes: [
        { id: 'node_1', type: 'action', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [],
      variables: {},
      metadata: { name: 'Workflow 1', tags: [] },
    };

    const diff = diffDefinitions(definition, definition);
    expect(diff.nodes_added).toHaveLength(0);
    expect(diff.nodes_removed).toHaveLength(0);
    expect(diff.nodes_modified).toHaveLength(0);
    expect(diff.edges_added).toHaveLength(0);
    expect(diff.edges_removed).toHaveLength(0);
    expect(diff.summary).toBe('no changes');
  });
});
