import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  api,
  nodeTypeColor,
  type TemplateSummary,
  type WorkflowTemplate,
} from '../lib/api';
import { Card, EmptyState, ErrorBlock, Icon, LoadingBlock } from '../components/ui';

/** Emoji + display label per industry (mirrors the registry taxonomy). */
const INDUSTRY_META: Record<string, { label: string; icon: string }> = {
  general: { label: 'General', icon: '⚡' },
  finance: { label: 'Finance', icon: '💰' },
  legal: { label: 'Legal', icon: '⚖️' },
  healthcare: { label: 'Healthcare', icon: '🏥' },
  education: { label: 'Education', icon: '🎓' },
  ecommerce: { label: 'E-commerce', icon: '🛒' },
  manufacturing: { label: 'Manufacturing', icon: '🏭' },
  'human-resources': { label: 'Human Resources', icon: '🧑‍💼' },
  marketing: { label: 'Marketing', icon: '📣' },
  'customer-support': { label: 'Customer Support', icon: '🎧' },
  sales: { label: 'Sales', icon: '📈' },
  'it-operations': { label: 'IT Operations', icon: '🛠️' },
};

function industryLabel(industry: string): string {
  return INDUSTRY_META[industry]?.label ?? industry.replace(/(^|-)(\w)/g, (_, p, c: string) => (p ? ' ' : '') + c.toUpperCase());
}

function industryIcon(industry: string): string {
  return INDUSTRY_META[industry]?.icon ?? '⚡';
}

/** Marketed category labels for the dropdown filter. */
const CATEGORY_LABELS: Record<string, string> = {
  automation: 'Automation',
  approval: 'Approval',
  monitoring: 'Monitoring',
  reporting: 'Reporting',
  knowledge: 'Knowledge',
  integration: 'Integration',
};

function TemplateCard({
  template,
  onOpen,
}: {
  template: TemplateSummary;
  onOpen: () => void;
}) {
  return (
    <Card hover className="cursor-pointer p-5 flex flex-col text-left" >
      <button type="button" onClick={onOpen} className="text-left flex flex-col flex-1 focus:outline-none">
        <div className="flex items-start justify-between mb-3">
          <span className="text-2xl leading-none" aria-hidden>
            {template.icon}
          </span>
          {template.featured && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-display font-semibold uppercase tracking-wider bg-volt-glow border border-volt/30 text-volt">
              ★ Featured
            </span>
          )}
        </div>
        <h3 className="font-display font-semibold text-ink-100 leading-snug">{template.name}</h3>
        <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-ink-500">
          {industryLabel(template.industry)} · {template.category}
        </div>
        <p className="mt-2.5 text-sm text-ink-400 leading-relaxed line-clamp-3">{template.description}</p>
        <div className="mt-auto pt-4 flex items-center justify-between text-[11px] text-ink-500 font-mono">
          <span>{template.node_count} nodes</span>
          <span className="flex items-center gap-1.5">
            {template.agents.map((a) => (
              <span
                key={a}
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: nodeTypeColor(`${a}.`) }}
                title={a}
              />
            ))}
          </span>
        </div>
      </button>
    </Card>
  );
}

/** Marketplace detail modal — full template preview + one-click instantiate. */
function TemplateDetailModal({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getTemplate(templateId)
      .then((t) => {
        if (!alive) return;
        setTemplate(t);
        setName(t.name);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [templateId]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const useTemplate = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const wf = await api.instantiateTemplate(template.id, {
        name: name.trim() || template.name,
      });
      navigate(`/workflows/${wf.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const variables = template ? Object.entries(template.definition.variables ?? {}) : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {!template && !error && <LoadingBlock label="Loading template…" />}
        {error && !template && <ErrorBlock message={error} onRetry={onClose} />}

        {template && (
          <>
            <div className="flex items-start gap-4">
              <span className="text-4xl leading-none" aria-hidden>
                {template.icon}
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-bold text-xl text-ink-100">{template.name}</h2>
                <div className="mt-1 text-[11px] font-mono uppercase tracking-wider text-ink-500">
                  {industryLabel(template.industry)} · {template.category} · {template.node_count} nodes
                </div>
              </div>
              <button className="btn-ghost !px-2 !py-1.5" onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>

            <p className="mt-4 text-sm text-ink-300 leading-relaxed">{template.description}</p>

            {template.use_cases.length > 0 && (
              <div className="mt-5">
                <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2">
                  What it does for you
                </div>
                <ul className="space-y-1.5">
                  {template.use_cases.map((uc) => (
                    <li key={uc} className="flex items-start gap-2 text-sm text-ink-300">
                      <span className="text-volt mt-0.5 shrink-0">
                        <Icon name="check" className="w-3.5 h-3.5" />
                      </span>
                      {uc}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5">
              <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2">
                Flow
              </div>
              <div className="flex flex-wrap gap-1.5">
                {template.definition.nodes.map((n) => (
                  <span
                    key={n.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono bg-ink-900/80 border border-ink-700 text-ink-300"
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: nodeTypeColor(n.type) }} />
                    {n.type}
                  </span>
                ))}
              </div>
            </div>

            {variables.length > 0 && (
              <div className="mt-5">
                <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2">
                  Variables you can tune
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {variables.map(([key, value]) => {
                    const def = (value as { default?: unknown })?.default;
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-mono bg-ink-900/80 border border-ink-700 text-ink-400"
                      >
                        <span className="text-volt">{key}</span>
                        {def !== undefined && <span className="ml-1.5 text-ink-500">= {String(def)}</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <div className="mt-4 text-sm text-bad">{error}</div>}

            <div className="mt-6 pt-5 border-t border-ink-700/60 flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-display font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
                  Workflow name
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={template.name}
                />
              </div>
              <button className="btn-primary whitespace-nowrap" onClick={useTemplate} disabled={busy}>
                <Icon name="play" />
                {busy ? 'Creating…' : 'Use this template'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Templates() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('all');
  const [category, setCategory] = useState('all');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .listTemplates()
      .then((result) => {
        if (!alive) return;
        setTemplates(result.templates);
        setIndustries(result.industries);
        setCategories(result.categories);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload]);

  // Client-side faceting over the (small) in-memory list for instant filter
  // response — the API supports the same filters server-side for consumers.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (featuredOnly && !t.featured) return false;
      if (industry !== 'all' && t.industry !== industry) return false;
      if (category !== 'all' && t.category !== category) return false;
      if (q) {
        const haystack = [t.id, t.name, t.description, ...t.tags, ...t.use_cases].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [templates, search, industry, category, featuredOnly]);

  // Industries with at least one template — keeps the chip row honest.
  const liveIndustries = useMemo(
    () => industries.filter((i) => templates.some((t) => t.industry === i)),
    [industries, templates],
  );

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-volt mb-1.5">Marketplace</div>
          <h1 className="font-display font-bold text-3xl tracking-tight text-ink-100">Templates</h1>
          <p className="text-sm text-ink-400 mt-1">
            Industry-proven starting points — pick one, tweak the variables, ship.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setReload((n) => n + 1)}>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>

      {/* Industry chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setIndustry('all')}
          className={clsx(
            'px-3 py-1.5 rounded-md text-xs font-display font-semibold transition-all border',
            industry === 'all'
              ? 'bg-volt-glow border-volt/30 text-volt'
              : 'border-ink-700 text-ink-400 hover:text-ink-200 hover:border-ink-600',
          )}
        >
          All industries
        </button>
        {liveIndustries.map((i) => (
          <button
            key={i}
            onClick={() => setIndustry(i)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-display font-semibold transition-all border inline-flex items-center gap-1.5',
              industry === i
                ? 'bg-volt-glow border-volt/30 text-volt'
                : 'border-ink-700 text-ink-400 hover:text-ink-200 hover:border-ink-600',
            )}
          >
            <span aria-hidden>{industryIcon(i)}</span>
            {industryLabel(i)}
          </button>
        ))}
      </div>

      {/* Search + category + featured */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
            <Icon name="search" />
          </span>
          <input
            className="input pl-9"
            placeholder="Search templates, use cases, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>
        <button
          onClick={() => setFeaturedOnly((v) => !v)}
          className={clsx(
            'px-3 py-1.5 rounded-md text-xs font-display font-semibold transition-all border inline-flex items-center gap-1.5',
            featuredOnly
              ? 'bg-volt-glow border-volt/30 text-volt'
              : 'border-ink-700 text-ink-400 hover:text-ink-200 hover:border-ink-600',
          )}
        >
          ★ Featured only
        </button>
        <span className="ml-auto text-xs font-mono text-ink-500">
          {filtered.length} / {templates.length}
        </span>
      </div>

      {loading && <LoadingBlock label="Loading templates…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={() => setReload((n) => n + 1)} />}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<Icon name="search" className="w-6 h-6" />}
          title="No templates match"
          hint="Try clearing the search or switching industry."
          action={
            <button
              className="btn-ghost"
              onClick={() => {
                setSearch('');
                setIndustry('all');
                setCategory('all');
                setFeaturedOnly(false);
              }}
            >
              Clear filters
            </button>
          }
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => (
            <TemplateCard key={t.id} template={t} onOpen={() => setSelected(t.id)} />
          ))}
        </div>
      )}

      {selected && <TemplateDetailModal templateId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
