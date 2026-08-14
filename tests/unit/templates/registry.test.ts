/**
 * Unit tests — TemplateRegistry (marketplace loader + queries).
 *
 * Uses throwaway fixture directories so the tests assert derivation,
 * filtering, sorting and isolation logic without touching the real
 * repository templates.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TemplateRegistry } from '../../../packages/templates/src/registry';
import type { TemplateFile } from '../../../packages/templates/src/interface';

function definition(tags: string[], name = 'Fixture flow') {
  return {
    version: '1.0',
    nodes: [
      { id: 'n1', type: 'vault.search', position: { x: 0, y: 0 }, config: {} },
      { id: 'n2', type: 'desk.create_task', position: { x: 220, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    variables: {},
    metadata: { name, description: '', tags },
  };
}

/** Legacy-style envelope: no marketplace fields — registry must derive them. */
const LEGACY_INVOICE: TemplateFile = {
  name: 'Invoice approval',
  description: 'Route invoices through desk approvals.',
  definition: definition(['invoice', 'finance', 'approval']),
};

/** Fully-declared envelope with every marketplace field. */
const DECLARED_MARKETING: TemplateFile = {
  id: 'weekly-digest',
  name: 'Weekly campaign digest',
  description: 'Summarize campaign metrics every Monday.',
  definition: definition(['marketing', 'campaign'], 'Weekly digest'),
  industry: 'marketing',
  category: 'reporting',
  featured: true,
  icon: '📣',
  use_cases: ['Monday leadership email', 'Channel performance review'],
};

describe('TemplateRegistry', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'loop-templates-'));
    writeFileSync(join(dir, 'invoice-approval.json'), JSON.stringify(LEGACY_INVOICE));
    writeFileSync(join(dir, 'featured-marketing.json'), JSON.stringify(DECLARED_MARKETING));
    // Broken file: definition fails WorkflowDefinitionSchema — must be skipped.
    writeFileSync(
      join(dir, 'broken.json'),
      JSON.stringify({ name: 'Broken', description: 'x', definition: { nodes: 'not-an-array' } }),
    );
    // Non-JSON files must be ignored entirely.
    writeFileSync(join(dir, 'README.txt'), 'ignore me');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads valid files, skips invalid ones and ignores non-JSON files', () => {
    const registry = new TemplateRegistry(dir);
    expect(registry.size).toBe(2);
    const errors = registry.getLoadErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.file).toBe('broken.json');
    expect(errors[0]!.error).toContain('nodes');
  });

  it('derives id, industry, category and icon from the file + taxonomy', () => {
    const registry = new TemplateRegistry(dir);
    const t = registry.get('invoice-approval');
    expect(t).toBeDefined();
    expect(t!.industry).toBe('finance');
    expect(t!.category).toBe('approval');
    expect(t!.featured).toBe(false);
    expect(t!.icon).toBe('💰'); // industry default glyph
    expect(t!.tags).toEqual(['invoice', 'finance', 'approval']);
  });

  it('honours declared marketplace fields over derivation', () => {
    const registry = new TemplateRegistry(dir);
    const t = registry.get('weekly-digest'); // envelope id wins over filename
    expect(t).toBeDefined();
    expect(t!.industry).toBe('marketing');
    expect(t!.category).toBe('reporting');
    expect(t!.featured).toBe(true);
    expect(t!.icon).toBe('📣');
    expect(t!.use_cases).toEqual(['Monday leadership email', 'Channel performance review']);
  });

  it('computes node_count and agents from the definition', () => {
    const registry = new TemplateRegistry(dir);
    const t = registry.get('invoice-approval')!;
    expect(t!.node_count).toBe(2);
    expect(t!.agents).toEqual(['desk', 'vault']); // sorted distinct prefixes
  });

  it('list() returns featured-first summaries without definitions', () => {
    const registry = new TemplateRegistry(dir);
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('weekly-digest'); // featured first
    expect(list[1]!.id).toBe('invoice-approval');
    for (const summary of list) {
      expect(summary).not.toHaveProperty('definition');
    }
  });

  it('filters by industry, category, featuredOnly and search', () => {
    const registry = new TemplateRegistry(dir);

    expect(registry.list({ industry: 'finance' }).map((t) => t.id)).toEqual(['invoice-approval']);
    expect(registry.list({ industry: 'all' })).toHaveLength(2); // 'all' is a no-op
    expect(registry.list({ category: 'reporting' }).map((t) => t.id)).toEqual(['weekly-digest']);
    expect(registry.list({ featuredOnly: true }).map((t) => t.id)).toEqual(['weekly-digest']);

    // Search is case-insensitive across name/description/tags/use_cases.
    expect(registry.list({ search: 'INVOICE' }).map((t) => t.id)).toEqual(['invoice-approval']);
    expect(registry.list({ search: 'leadership email' }).map((t) => t.id)).toEqual(['weekly-digest']);
    expect(registry.list({ search: 'no-such-thing' })).toEqual([]);
  });

  it('get() returns the full definition, unknown ids return undefined', () => {
    const registry = new TemplateRegistry(dir);
    expect(registry.get('invoice-approval')!.definition.nodes).toHaveLength(2);
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('instantiate() overrides name/description and syncs metadata', () => {
    const registry = new TemplateRegistry(dir);
    const result = registry.instantiate('invoice-approval', {
      name: 'ACME invoice flow',
      description: 'Customized for ACME',
    })!;
    expect(result.name).toBe('ACME invoice flow');
    expect(result.description).toBe('Customized for ACME');
    expect(result.definition.metadata.name).toBe('ACME invoice flow');
    expect(result.definition.metadata.description).toBe('Customized for ACME');
    expect(result.featured).toBeUndefined(); // marketplace-only fields stripped
  });

  it('instantiate() falls back to template values for blank overrides', () => {
    const registry = new TemplateRegistry(dir);
    const result = registry.instantiate('invoice-approval', { name: '   ' })!;
    expect(result.name).toBe('Invoice approval');
  });

  it('instantiate() deep-copies — mutations never leak into the registry', () => {
    const registry = new TemplateRegistry(dir);
    const first = registry.instantiate('invoice-approval')!;
    first.definition.nodes[0]!.config['injected'] = true;
    first.definition.metadata.tags.push('mutated');

    const second = registry.instantiate('invoice-approval')!;
    expect(second.definition.nodes[0]!.config['injected']).toBeUndefined();
    expect(second.definition.metadata.tags).not.toContain('mutated');
    expect(registry.get('invoice-approval')!.definition.nodes[0]!.config['injected']).toBeUndefined();
  });

  it('instantiate() returns undefined for unknown ids', () => {
    expect(new TemplateRegistry(dir).instantiate('nope')).toBeUndefined();
  });

  it('a directory with no .json files yields an empty registry', () => {
    const empty = mkdtempSync(join(tmpdir(), 'loop-templates-empty-'));
    try {
      const registry = new TemplateRegistry(empty);
      expect(registry.size).toBe(0);
      expect(registry.list()).toEqual([]);
      expect(registry.getLoadErrors()).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
