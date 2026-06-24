import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../../packages/workflow-authoring/src/validator';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../../../packages/types/src/schemas/workflow';

function node(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'noop',
    position: { x: 0, y: 0 },
    config: {},
    ...overrides,
  };
}

function edge(id: string, source: string, target: string, overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id,
    source,
    source_port: 'output',
    target,
    target_port: 'input',
    type_compatibility: true,
    ...overrides,
  };
}

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    version: '1.0',
    nodes: [],
    edges: [],
    variables: {},
    metadata: {},
    ...overrides,
  };
}

describe('@loop/workflow-authoring — validateWorkflow', () => {
  describe('valid workflows', () => {
    it('accepts a simple linear workflow (A → B → C)', () => {
      const def = workflow({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts a single-node workflow with no edges', () => {
      const def = workflow({ nodes: [node('only')] });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('accepts a diamond DAG (A → B, A → C, B → D, C → D)', () => {
      const def = workflow({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [
          edge('e1', 'A', 'B'),
          edge('e2', 'A', 'C'),
          edge('e3', 'B', 'D'),
          edge('e4', 'C', 'D'),
        ],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('empty workflow', () => {
    it('produces a warning and still reports valid', () => {
      const result = validateWorkflow(workflow());
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => /no nodes/i.test(w))).toBe(true);
    });
  });

  describe('cycle detection', () => {
    it('fails when a direct cycle exists (A → B → A)', () => {
      const def = workflow({
        nodes: [node('A'), node('B')],
        edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /circular|cycle/i.test(e))).toBe(true);
    });

    it('fails on a longer cycle (A → B → C → A)', () => {
      const def = workflow({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'A')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /circular|cycle/i.test(e))).toBe(true);
    });

    it('fails on a self-loop (A → A)', () => {
      const def = workflow({
        nodes: [node('A')],
        edges: [edge('e1', 'A', 'A')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /circular|cycle/i.test(e))).toBe(true);
    });
  });

  describe('orphan / unreachable component detection', () => {
    // isReachable() returns false only when there are no in-degree-0 nodes
    // — i.e., the graph is composed entirely of cycles. Two disjoint cycles
    // therefore produce an "orphan / not reachable" error AND a cycle error.
    it('fails when two disconnected cyclic components exist (no start nodes)', () => {
      const def = workflow({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [
          edge('e1', 'A', 'B'),
          edge('e2', 'B', 'A'),
          edge('e3', 'C', 'D'),
          edge('e4', 'D', 'C'),
        ],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /orphan|reachable/i.test(e))).toBe(true);
    });

    it('disconnected DAG components still pass reachability (each component has a start node)', () => {
      const def = workflow({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('e1', 'A', 'B'), edge('e2', 'C', 'D')],
      });
      const result = validateWorkflow(def);
      // isReachable visits all nodes from in-degree-0 roots, so this passes.
      expect(result.valid).toBe(true);
    });
  });

  describe('unknown source/target node in edge', () => {
    it('fails when an edge references an unknown source node', () => {
      const def = workflow({
        nodes: [node('B')],
        edges: [edge('e1', 'ghost', 'B')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /unknown source.*ghost/i.test(e))).toBe(true);
    });

    it('fails when an edge references an unknown target node', () => {
      const def = workflow({
        nodes: [node('A')],
        edges: [edge('e1', 'A', 'void')],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /unknown target.*void/i.test(e))).toBe(true);
    });

    it('fails when edge has incompatible port types', () => {
      const def = workflow({
        nodes: [node('A'), node('B')],
        edges: [edge('e1', 'A', 'B', { type_compatibility: false })],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /incompatible/i.test(e))).toBe(true);
    });
  });

  describe('variable reference warnings', () => {
    it('warns about an unresolvable {{variable}} reference', () => {
      const def = workflow({
        nodes: [node('A', { config: { greeting: '{{unknownVar}}' } })],
        edges: [],
      });
      const result = validateWorkflow(def);
      expect(result.warnings.some((w) => /unknownVar/.test(w) && /may not resolve/i.test(w))).toBe(true);
    });

    it('does not warn about a {{trigger.payload.*}} reference', () => {
      const def = workflow({
        nodes: [node('A', { config: { data: '{{trigger.payload.user}}' } })],
        edges: [],
      });
      const result = validateWorkflow(def);
      expect(result.warnings.some((w) => /trigger\.payload/.test(w) && /may not resolve/i.test(w))).toBe(false);
    });

    it('does not warn about a {{node_X.output.*}} reference', () => {
      const def = workflow({
        nodes: [node('A', { config: { data: '{{node_A.output.result}}' } })],
        edges: [],
      });
      const result = validateWorkflow(def);
      expect(result.warnings.some((w) => /node_A\.output/.test(w) && /may not resolve/i.test(w))).toBe(false);
    });

    it('does not warn when a workflow variable is defined', () => {
      const def = workflow({
        nodes: [node('A', { config: { data: '{{myVar}}' } })],
        variables: { myVar: { type: 'string' } },
      });
      const result = validateWorkflow(def);
      expect(result.warnings.some((w) => /myVar/.test(w) && /may not resolve/i.test(w))).toBe(false);
    });
  });

  describe('duplicate node IDs', () => {
    it('fails when duplicate node IDs exist', () => {
      const def = workflow({
        nodes: [node('dup'), node('dup')],
        edges: [],
      });
      const result = validateWorkflow(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /duplicate node id/i.test(e))).toBe(true);
    });
  });
});
