/**
 * TemplateRegistry — loads template files from disk, validates them, enriches
 * them with marketplace metadata and serves list/get/instantiate queries.
 *
 * Loading strategy: read every `*.json` in the templates directory, parse the
 * envelope, validate the embedded definition against WorkflowDefinitionSchema,
 * and skip (recording) files that fail — a broken template must never take the
 * API down. Marketplace fields absent from a file are derived from its tags via
 * the taxonomy below so legacy templates appear in the gallery automatically.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowDefinitionSchema } from '@loop/types';
import type { WorkflowDefinition } from '@loop/types';
import { CATEGORIES, INDUSTRIES } from './interface.js';
import type {
  Industry,
  InstantiateOptions,
  TemplateCategory,
  TemplateFile,
  TemplateFilters,
  TemplateSummary,
  WorkflowTemplate,
} from './interface.js';

/** Tag patterns → industry, checked in order (first match wins). */
const TAG_INDUSTRY: Array<[RegExp, Industry]> = [
  [/\b(invoice|payment|finance|financial|expense|billing|reconciliation|accounting)\b/i, 'finance'],
  [/\b(legal|contract|compliance|nda|litigation|counsel)\b/i, 'legal'],
  [/\b(health|patient|clinical|hipaa|medical)\b/i, 'healthcare'],
  [/\b(education|course|student|learning|campus)\b/i, 'education'],
  [/\b(ecommerce|e-?commerce|order|inventory|catalog|shop|store|cart)\b/i, 'ecommerce'],
  [/\b(manufacturing|production|factory|equipment|quality|iot|sensor)\b/i, 'manufacturing'],
  [/\b(hr|human[- ]resources|onboarding|employee|recruiting|payroll|leave)\b/i, 'human-resources'],
  [/\b(marketing|campaign|seo|content|social|brand|newsletter)\b/i, 'marketing'],
  [/\b(support|ticket|helpdesk|sla|escalation|customer[- ]service)\b/i, 'customer-support'],
  [/\b(sales|lead|crm|pipeline|prospect|deal)\b/i, 'sales'],
  [/\b(incident|devops|it[- ]ops|infrastructure|monitoring|alerting)\b/i, 'it-operations'],
];

/** Tag patterns → category (first match wins, defaults to automation). */
const TAG_CATEGORY: Array<[RegExp, TemplateCategory]> = [
  [/\bapproval\b/i, 'approval'],
  [/\b(monitor|alert|incident|observ)/i, 'monitoring'],
  [/\b(report|digest|summar|analytics)/i, 'reporting'],
  [/\b(knowledge|rag|ingest|index)/i, 'knowledge'],
  [/\b(sync|integration|webhook)\b/i, 'integration'],
];

/** Default gallery glyph per industry. */
const INDUSTRY_ICON: Record<Industry, string> = {
  general: '⚡',
  finance: '💰',
  legal: '⚖️',
  healthcare: '🏥',
  education: '🎓',
  ecommerce: '🛒',
  manufacturing: '🏭',
  'human-resources': '🧑‍💼',
  marketing: '📣',
  'customer-support': '🎧',
  sales: '📈',
  'it-operations': '🛠️',
};

const AGENT_PREFIXES = ['vault', 'desk', 'recap', 'generic', 'control', 'code'] as const;

function deriveIndustry(tags: readonly string[]): Industry {
  for (const [pattern, industry] of TAG_INDUSTRY) {
    if (tags.some((tag) => pattern.test(tag))) return industry;
  }
  return 'general';
}

function deriveCategory(tags: readonly string[]): TemplateCategory {
  for (const [pattern, category] of TAG_CATEGORY) {
    if (tags.some((tag) => pattern.test(tag))) return category;
  }
  return 'automation';
}

function agentsOf(definition: WorkflowDefinition): string[] {
  const found = new Set<string>();
  for (const node of definition.nodes) {
    const prefix = AGENT_PREFIXES.find((p) => node.type.startsWith(`${p}.`));
    if (prefix) found.add(prefix);
  }
  return [...found].sort();
}

function toKebabId(fileName: string): string {
  return fileName
    .replace(/\.json$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** A template file that failed to load — surfaced via getLoadErrors(). */
export interface TemplateLoadError {
  file: string;
  error: string;
}

export class TemplateRegistry {
  private readonly templates = new Map<string, WorkflowTemplate>();
  private readonly templatesDir: string;
  private readonly loadErrors: TemplateLoadError[] = [];

  constructor(templatesDir?: string) {
    this.templatesDir = this.resolveDir(templatesDir);
    this.load();
  }

  /** Directory search order: explicit arg → env → module-relative → cwd walk-up. */
  private resolveDir(explicit?: string): string {
    const candidates: string[] = [];
    if (explicit) candidates.push(resolve(explicit));
    const envDir = process.env['LOOP_TEMPLATES_DIR'];
    if (envDir) candidates.push(resolve(envDir));
    // dist/registry.js and src/registry.ts are both two levels below the
    // package root, so ../../../templates always points at the repo templates.
    const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    candidates.push(join(moduleRoot, 'templates'));
    let cwd = process.cwd();
    for (let i = 0; i < 6; i += 1) {
      candidates.push(join(cwd, 'templates'));
      const parent = dirname(cwd);
      if (parent === cwd) break;
      cwd = parent;
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0] ?? join(process.cwd(), 'templates');
  }

  private load(): void {
    if (!existsSync(this.templatesDir)) return;
    const files = readdirSync(this.templatesDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(this.templatesDir, file), 'utf8')) as TemplateFile;
        const parsed = WorkflowDefinitionSchema.safeParse(raw.definition);
        if (!parsed.success) {
          this.loadErrors.push({
            file,
            error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          });
          continue;
        }
        const id = raw.id ? toKebabId(`${raw.id}`) : toKebabId(file);
        const template = this.toTemplate(raw, parsed.data, id);
        // On id collision the later file wins but keeps a unique key.
        this.templates.set(this.templates.has(id) ? `${id}-${this.templates.size}` : id, template);
      } catch (err) {
        this.loadErrors.push({ file, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private toTemplate(file: TemplateFile, definition: WorkflowDefinition, id: string): WorkflowTemplate {
    const tags = definition.metadata?.tags ?? [];
    const industry: Industry = file.industry && INDUSTRIES.includes(file.industry) ? file.industry : deriveIndustry(tags);
    const category: TemplateCategory =
      file.category && CATEGORIES.includes(file.category) ? file.category : deriveCategory(tags);
    return {
      id,
      name: file.name,
      description: file.description,
      industry,
      category,
      featured: file.featured ?? false,
      icon: file.icon ?? INDUSTRY_ICON[industry],
      use_cases: file.use_cases ?? [],
      node_count: definition.nodes.length,
      agents: agentsOf(definition),
      tags,
      definition,
    };
  }

  /** Gallery listing with optional filters; featured templates sorted first. */
  list(filters: TemplateFilters = {}): TemplateSummary[] {
    const search = filters.search?.trim().toLowerCase();
    const result: TemplateSummary[] = [];
    for (const template of this.templates.values()) {
      if (filters.industry && filters.industry !== 'all' && template.industry !== filters.industry) continue;
      if (filters.category && filters.category !== 'all' && template.category !== filters.category) continue;
      if (filters.featuredOnly && !template.featured) continue;
      if (search) {
        const haystack = [
          template.id,
          template.name,
          template.description,
          ...template.tags,
          ...template.use_cases,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      const { definition: _definition, ...summary } = template;
      result.push(summary);
    }
    return result.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Full template (definition included) by id. */
  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Prepare a template for creation: deep-copies the definition and overrides
   * the workflow name/description (metadata included) with the user's choices.
   * Returns undefined for unknown ids.
   */
  instantiate(id: string, options: InstantiateOptions = {}): Omit<WorkflowTemplate, 'id' | 'featured'> | undefined {
    const template = this.templates.get(id);
    if (!template) return undefined;
    const definition = structuredClone(template.definition) as WorkflowDefinition;
    const name = options.name?.trim() || template.name;
    const description = options.description?.trim() || template.description;
    definition.metadata = {
      ...definition.metadata,
      name,
      description,
      tags: [...(definition.metadata?.tags ?? [])],
    };
    const { id: _id, featured: _featured, ...rest } = template;
    return { ...rest, name, description, definition };
  }

  /** Number of successfully loaded templates. */
  get size(): number {
    return this.templates.size;
  }

  /** Templates directory actually in use (useful for diagnostics). */
  get dir(): string {
    return this.templatesDir;
  }

  /** Files skipped during load, with the reason — empty when all loaded. */
  getLoadErrors(): readonly TemplateLoadError[] {
    return this.loadErrors;
  }
}
