/**
 * Template registry contracts — the marketplace data model.
 *
 * A template file is a JSON envelope around a WorkflowDefinition. The optional
 * marketplace fields (industry/category/featured/…) are honoured when present;
 * otherwise the registry derives them from the definition's tags via the
 * taxonomy, so legacy template files keep working unchanged.
 */

import type { WorkflowDefinition } from '@loop/types';

/** Vertical a template targets (drives marketplace filtering). */
export const INDUSTRIES = [
  'general',
  'finance',
  'legal',
  'healthcare',
  'education',
  'ecommerce',
  'manufacturing',
  'human-resources',
  'marketing',
  'customer-support',
  'sales',
  'it-operations',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Functional grouping (what kind of automation it is). */
export const CATEGORIES = [
  'automation',
  'approval',
  'monitoring',
  'reporting',
  'knowledge',
  'integration',
] as const;
export type TemplateCategory = (typeof CATEGORIES)[number];

/** Raw on-disk template envelope (marketplace fields all optional). */
export interface TemplateFile {
  /** Marketplace id — derived from the filename when absent. */
  id?: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  industry?: Industry;
  category?: TemplateCategory;
  /** Pinned to the top of the gallery when true. */
  featured?: boolean;
  /** Short bullet scenarios shown on the detail card. */
  use_cases?: string[];
  /** Emoji glyph rendered on the marketplace card. */
  icon?: string;
}

/** Gallery-facing summary (definition excluded — cheap to list). */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  industry: Industry;
  category: TemplateCategory;
  featured: boolean;
  icon: string;
  use_cases: string[];
  node_count: number;
  /** Distinct agent prefixes used by the definition (vault/desk/recap/generic/control/code). */
  agents: string[];
  tags: string[];
}

/** Full template for the detail view and instantiation. */
export interface WorkflowTemplate extends TemplateSummary {
  definition: WorkflowDefinition;
}

/** Filters accepted by TemplateRegistry.list(). */
export interface TemplateFilters {
  industry?: Industry | 'all';
  category?: TemplateCategory | 'all';
  /** Case-insensitive substring over name/description/tags/use_cases. */
  search?: string;
  featuredOnly?: boolean;
}

/** Result of preparing a template for creation (name may be overridden). */
export interface InstantiateOptions {
  name?: string;
  description?: string;
}
