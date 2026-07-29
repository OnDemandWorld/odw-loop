/**
 * Template validation tests — ensures all workflow templates in /templates
 * conform to the WorkflowDefinitionSchema and pass topology validation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowDefinitionSchema } from '../../../packages/types/src/schemas/workflow';
import { validateWorkflow } from '../../../packages/workflow-authoring/src/validator';
import { topologicalSort } from '../../../packages/engine/src/scheduler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../../../templates');

interface TemplateFile {
  filename: string;
  name: string;
  description: string;
  definition: unknown;
}

function loadTemplates(): TemplateFile[] {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  return files.map((filename) => {
    const raw = readFileSync(join(TEMPLATES_DIR, filename), 'utf8');
    const parsed = JSON.parse(raw) as { name: string; description: string; definition: unknown };
    return { filename, name: parsed.name, description: parsed.description, definition: parsed.definition };
  });
}

describe('Workflow Templates', () => {
  const templates = loadTemplates();

  it('should have at least 8 templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(8);
  });

  describe.each(templates.map((t) => [t.filename, t] as [string, TemplateFile]))(
    '%s',
    (_filename, template) => {
      it('should have name and description', () => {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.description.length).toBeGreaterThan(20);
      });

      it('should parse against WorkflowDefinitionSchema', () => {
        const result = WorkflowDefinitionSchema.safeParse(template.definition);
        if (!result.success) {
          const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          expect.fail(`Schema validation failed: ${issues}`);
        }
        expect(result.success).toBe(true);
      });

      it('should pass topology validation (no cycles, no orphans)', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        const validation = validateWorkflow(parsed);
        if (!validation.valid) {
          expect.fail(`Topology validation failed: ${validation.errors.join('; ')}`);
        }
        expect(validation.valid).toBe(true);
      });

      it('should produce a valid topological sort', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        if (parsed.nodes.length === 0) return;
        const sorted = topologicalSort(parsed.nodes, parsed.edges);
        expect(sorted.length).toBe(parsed.nodes.length);
      });

      it('should have unique node IDs', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        const ids = parsed.nodes.map((n) => n.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it('should have unique edge IDs', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        const ids = parsed.edges.map((e) => e.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it('should only reference existing nodes in edges', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        const nodeIds = new Set(parsed.nodes.map((n) => n.id));
        for (const edge of parsed.edges) {
          expect(nodeIds.has(edge.source), `Edge ${edge.id} references unknown source '${edge.source}'`).toBe(true);
          expect(nodeIds.has(edge.target), `Edge ${edge.id} references unknown target '${edge.target}'`).toBe(true);
        }
      });

      it('should have valid node types (connector.operation or control.*)', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        const validPrefixes = ['vault', 'desk', 'recap', 'generic', 'control'];
        for (const node of parsed.nodes) {
          const prefix = node.type.split('.')[0];
          expect(validPrefixes, `Node '${node.id}' has invalid type prefix '${prefix}'`).toContain(prefix);
        }
      });

      it('should have valid retry configs where specified', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        for (const node of parsed.nodes) {
          if (node.retry) {
            expect(node.retry.max_attempts).toBeGreaterThanOrEqual(0);
            expect(node.retry.max_attempts).toBeLessThanOrEqual(10);
            expect(['exponential', 'linear', 'fixed']).toContain(node.retry.backoff);
            expect(node.retry.initial_delay_ms).toBeGreaterThanOrEqual(0);
          }
        }
      });

      it('should have valid timeout_ms where specified', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        for (const node of parsed.nodes) {
          if (node.timeout_ms !== undefined) {
            expect(node.timeout_ms).toBeGreaterThan(0);
            // Control nodes (approval gates) may have long timeouts (up to 7 days)
            const maxTimeout = node.type.startsWith('control.') ? 604800000 : 600000;
            expect(node.timeout_ms).toBeLessThanOrEqual(maxTimeout);
          }
        }
      });

      it('should have metadata with tags', () => {
        const parsed = WorkflowDefinitionSchema.parse(template.definition);
        expect(parsed.metadata).toBeDefined();
        expect(parsed.metadata.tags).toBeDefined();
        expect(parsed.metadata.tags.length).toBeGreaterThan(0);
      });
    },
  );
});
