import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, timeAgo, shortId, type Workflow, type WorkflowDefinition } from '../lib/api';
import {
  Card,
  EmptyState,
  ErrorBlock,
  Icon,
  LoadingBlock,
  SectionTitle,
  StatusBadge,
} from '../components/ui';

const BLANK_DEFINITION: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: '', description: '', tags: [] },
};

function CreateWorkflowModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (wf: Workflow) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const definition: WorkflowDefinition = {
        ...BLANK_DEFINITION,
        metadata: {
          name: name.trim(),
          description: description.trim(),
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      };
      const wf = await api.createWorkflow({
        name: name.trim(),
        description: description.trim(),
        definition,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
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
        className="panel w-full max-w-md p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display font-bold text-lg text-ink-100 mb-1">New workflow</h2>
        <p className="text-sm text-ink-400 mb-5">
          Create an empty DAG and compose it in the visual editor.
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
          {error && <div className="text-sm text-rose-300">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create workflow'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Workflows() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listWorkflows({ per_page: 100 })
      .then((r) => {
        setWorkflows(r.data ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!workflows) return [];
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
      await api.archiveWorkflow(wf.id);
      load();
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

      {error && (
        <div className="mb-4 text-sm text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded-md px-4 py-2.5">
          {error}
        </div>
      )}

      {workflows === null ? (
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
