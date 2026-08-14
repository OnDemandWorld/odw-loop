import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, timeAgo, type TemplateSummary, type Workflow, type WorkflowDefinition } from '../lib/api';
import { useWorkflowStore } from '../store/workflows';
import { Card, EmptyState, Icon, LoadingBlock, StatusBadge } from '../components/ui';

const BLANK_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: '', description: '', tags: [] },
};

/**
 * Two-step creation wizard (Zapier-style):
 *   Step 1 — pick a starting point: featured industry template or blank canvas.
 *   Step 2 — name / describe / tag it (prefilled from the template).
 * Also links out to the full marketplace for browsing all templates.
 */
function CreateWorkflowModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (wf: Workflow) => void;
}) {
  const navigate = useNavigate();
  const createWorkflow = useWorkflowStore((s) => s.createWorkflow);
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<TemplateSummary | null>(null);
  const [featured, setFeatured] = useState<TemplateSummary[] | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Featured templates for the quick-pick grid — degrade to blank-only on failure.
  useEffect(() => {
    let alive = true;
    api
      .listTemplates({ featured: true })
      .then((r) => alive && setFeatured(r.templates))
      .catch(() => alive && setFeatured([]));
    return () => {
      alive = false;
    };
  }, []);

  const pick = (t: TemplateSummary | null) => {
    setPicked(t);
    setName(t?.name ?? '');
    setDescription(t?.description ?? '');
    setTags(t ? t.tags.slice(0, 4).join(', ') : '');
    setError(null);
    setStep(2);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let wf: Workflow;
      if (picked) {
        wf = await api.instantiateTemplate(picked.id, {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        });
      } else {
        const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
        const definition: WorkflowDefinition = {
          ...BLANK_DEFINITION,
          metadata: { name: name.trim(), description: description.trim(), tags: tagList },
        };
        wf = await createWorkflow({
          name: name.trim(),
          description: description.trim(),
          definition,
          tags: tagList,
        });
      }
      onCreated(wf);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-lg p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 && (
          <>
            <h2 className="font-display font-bold text-lg text-ink-100 mb-1">New workflow</h2>
            <p className="text-sm text-ink-400 mb-5">Start from a proven template or a blank canvas.</p>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-lg border border-dashed border-ink-600 hover:border-volt/50 hover:bg-volt-glow/40 transition-all text-left"
              >
                <span className="w-9 h-9 rounded-md bg-ink-800 border border-ink-700 flex items-center justify-center text-ink-300 shrink-0">
                  <Icon name="plus" />
                </span>
                <span>
                  <span className="block text-sm font-display font-semibold text-ink-100">Start from scratch</span>
                  <span className="block text-xs text-ink-400 mt-0.5">
                    Build node by node with the visual editor.
                  </span>
                </span>
              </button>

              {featured === null && (
                <div className="text-xs text-ink-500 font-mono px-1 py-2">Loading templates…</div>
              )}

              {featured && featured.length > 0 && (
                <div>
                  <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2 px-1 mt-3">
                    Recommended templates
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {featured.slice(0, 6).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => pick(t)}
                        className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-ink-700 bg-ink-800/50 hover:border-ink-600 hover:bg-ink-750 transition-all text-left"
                      >
                        <span className="text-lg leading-none shrink-0" aria-hidden>
                          {t.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-display font-semibold text-ink-100 truncate">
                            {t.name}
                          </span>
                          <span className="block text-[10px] font-mono uppercase tracking-wider text-ink-500 truncate">
                            {t.industry} · {t.node_count} nodes
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-ink-700/60 flex items-center justify-between">
              <button
                type="button"
                className="text-xs text-volt hover:text-volt/80 font-medium"
                onClick={() => {
                  onClose();
                  navigate('/templates');
                }}
              >
                Browse all templates →
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display font-bold text-lg text-ink-100">
                {picked ? 'Create from template' : 'New workflow'}
              </h2>
              <button className="btn-ghost !px-2 !py-1.5" onClick={onClose} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <p className="text-sm text-ink-400 mb-4">
              {picked ? (
                <>
                  From{' '}
                  <span className="text-ink-200">
                    {picked.icon} {picked.name}
                  </span>{' '}
                  ·{' '}
                  <button
                    type="button"
                    className="text-volt hover:text-volt/80"
                    onClick={() => setStep(1)}
                  >
                    change
                  </button>
                </>
              ) : (
                'An empty DAG you compose in the visual editor.'
              )}
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-display font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
                  Name
                </label>
                <input
                  className="input"
                  autoFocus
                  placeholder="e.g. nightly-knowledge-digest"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-display font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
                  Description
                </label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder="What does this workflow automate?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-display font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
                  Tags <span className="text-ink-500 normal-case font-body font-normal">(comma separated)</span>
                </label>
                <input
                  className="input"
                  placeholder="automation, vault"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
              {error && <div className="text-sm text-bad">{error}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                  <Icon name="arrowLeft" />
                  Back
                </button>
                <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : picked ? 'Create from template' : 'Create workflow'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export function Workflows() {
  const navigate = useNavigate();
  // V1.1 M2 (F4): workflow list state lives in the global Zustand store.
  const workflows = useWorkflowStore((s) => s.workflows);
  const loaded = useWorkflowStore((s) => s.loaded);
  const loadError = useWorkflowStore((s) => s.error);
  const load = useWorkflowStore((s) => s.load);
  const deleteWorkflow = useWorkflowStore((s) => s.deleteWorkflow);

  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  useEffect(() => {
    void load({ per_page: 100 });
  }, [load]);

  const filtered = useMemo(() => {
    return workflows.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          w.name.toLowerCase().includes(q) ||
          w.description.toLowerCase().includes(q) ||
          w.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [workflows, search, statusFilter]);

  const runWorkflow = async (wf: Workflow) => {
    setActionBusy(wf.id);
    try {
      const result = await api.executeWorkflow(wf.id);
      navigate(`/executions/${result.execution_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActionBusy(null);
    }
  };

  const archiveWorkflow = async (wf: Workflow) => {
    setActionBusy(wf.id);
    try {
      await deleteWorkflow(wf.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-volt mb-1.5">
            Authoring
          </div>
          <h1 className="font-display font-bold text-3xl tracking-tight text-ink-100">Workflows</h1>
          <p className="text-sm text-ink-400 mt-1">
            DAG-based automations chaining Vault, Desk and Recap agents.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Icon name="plus" />
          New workflow
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500">
            <Icon name="search" />
          </span>
          <input
            className="input pl-9"
            placeholder="Search by name, description or tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5">
          {['all', 'draft', 'active', 'archived'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-display font-semibold capitalize transition-all border ' +
                (statusFilter === s
                  ? 'bg-volt-glow border-volt/30 text-volt'
                  : 'border-ink-700 text-ink-400 hover:text-ink-200 hover:border-ink-600')
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {(error ?? loadError) && (
        <div className="mb-4 text-sm text-bad bg-bad/10 border border-bad/30 rounded-md px-4 py-2.5">
          {error ?? loadError}
        </div>
      )}

      {!loaded ? (
        <LoadingBlock label="Loading workflows…" />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="workflow" className="w-6 h-6" />}
            title={workflows.length === 0 ? 'No workflows yet' : 'Nothing matches your filters'}
            hint={
              workflows.length === 0
                ? 'Create your first workflow to start orchestrating the sovereign agent suite.'
                : 'Try a different search term or status filter.'
            }
            action={
              workflows.length === 0 ? (
                <button className="btn-primary" onClick={() => setShowCreate(true)}>
                  <Icon name="plus" />
                  Create workflow
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((wf, i) => (
            <Card key={wf.id} hover className="p-5 flex flex-col animate-slide-up" >
              <div style={{ animationDelay: `${i * 40}ms` }} className="flex flex-col flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/workflows/${wf.id}`}
                    className="font-display font-semibold text-ink-100 hover:text-volt transition-colors leading-snug"
                  >
                    {wf.name}
                  </Link>
                  <StatusBadge status={wf.status} />
                </div>
                <p className="text-sm text-ink-400 mt-2 line-clamp-2 flex-1">
                  {wf.description || 'No description'}
                </p>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {wf.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  <span className="tag text-ink-500">v{wf.version}</span>
                  <span className="tag text-ink-500">
                    {wf.definition?.nodes?.length ?? 0} nodes
                  </span>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-700/60">
                  <span className="text-[11px] text-ink-500 font-mono">
                    updated {timeAgo(wf.updated_at)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="btn-ghost !px-2.5 !py-1.5"
                      title="Run now"
                      disabled={actionBusy === wf.id}
                      onClick={() => runWorkflow(wf)}
                    >
                      <Icon name="play" className="w-3.5 h-3.5" />
                    </button>
                    <Link className="btn-ghost !px-2.5 !py-1.5" title="Edit" to={`/workflows/${wf.id}`}>
                      <Icon name="edit" className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      className="btn-danger !px-2.5 !py-1.5"
                      title="Archive"
                      disabled={actionBusy === wf.id || wf.status === 'archived'}
                      onClick={() => archiveWorkflow(wf)}
                    >
                      <Icon name="trash" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWorkflowModal
          onClose={() => setShowCreate(false)}
          onCreated={(wf) => {
            setShowCreate(false);
            navigate(`/workflows/${wf.id}`);
          }}
        />
      )}
    </div>
  );
}
