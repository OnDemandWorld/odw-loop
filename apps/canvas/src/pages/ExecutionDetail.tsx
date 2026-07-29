import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  api,
  formatDuration,
  nodeTypeColor,
  shortId,
  type Execution,
  type NodeExecution,
} from '../lib/api';
import { Card, Icon, LoadingBlock, SectionTitle, StatusBadge } from '../components/ui';

function NodeTraceRow({ node, index }: { node: NodeExecution; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const accent = nodeTypeColor(node.node_type);
  const hasDetail =
    Object.keys(node.output ?? {}).length > 0 ||
    Object.keys(node.input ?? {}).length > 0 ||
    node.error;

  return (
    <div
      className="rounded-md border border-ink-700/70 bg-ink-800/50 overflow-hidden animate-slide-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-750/50 transition-colors"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        disabled={!hasDetail}
      >
        <span className="font-mono text-[10px] text-ink-500 w-5">{String(index + 1).padStart(2, '0')}</span>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
        <span className="font-mono text-sm text-ink-100">{node.node_id}</span>
        <span className="tag">{node.node_type}</span>
        {node.retry_count > 0 && <span className="tag text-amber-300">retries:{node.retry_count}</span>}
        <span className="ml-auto font-mono text-xs text-ink-400">{formatDuration(nodeDuration(node))}</span>
        <StatusBadge status={node.status} />
        {hasDetail && (
          <span className={clsx('text-ink-500 transition-transform', expanded && 'rotate-90')}>›</span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-ink-700/60 space-y-3 animate-fade-in">
          {node.error && (
            <div>
              <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-rose-400 mb-1">
                Error
              </div>
              <pre className="font-mono text-xs text-rose-200 bg-rose-950/40 border border-rose-900/50 rounded-md p-3 whitespace-pre-wrap">
                {node.error}
              </pre>
            </div>
          )}
          {Object.keys(node.input ?? {}).length > 0 && (
            <div>
              <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-1">
                Input
              </div>
              <pre className="font-mono text-xs text-ink-300 bg-ink-900/70 border border-ink-700 rounded-md p-3 overflow-x-auto">
                {JSON.stringify(node.input, null, 2)}
              </pre>
            </div>
          )}
          {Object.keys(node.output ?? {}).length > 0 && (
            <div>
              <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-1">
                Output
              </div>
              <pre className="font-mono text-xs text-emerald-200/90 bg-ink-900/70 border border-ink-700 rounded-md p-3 overflow-x-auto">
                {JSON.stringify(node.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function nodeDuration(node: NodeExecution): number | null {
  if (node.started_at && node.completed_at) {
    return new Date(node.completed_at).getTime() - new Date(node.started_at).getTime();
  }
  return null;
}

export function ExecutionDetail() {
  const { id } = useParams<{ id: string }>();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api
      .getExecution(id)
      .then((ex) => {
        setExecution(ex);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(load, [load]);

  // Poll while the execution is still active
  useEffect(() => {
    if (!execution || !['pending', 'running', 'paused'].includes(execution.status)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [execution?.status, load]);

  if (error) {
    return (
      <div className="p-8">
        <div className="text-rose-300 text-sm">Failed to load execution: {error}</div>
        <Link to="/executions" className="btn-ghost mt-4 inline-flex">
          <Icon name="arrowLeft" /> Back to executions
        </Link>
      </div>
    );
  }
  if (!execution) return <LoadingBlock label="Loading execution…" />;

  const nodes = execution.nodes ?? [];
  const progress =
    nodes.length > 0
      ? Math.round((nodes.filter((n) => ['succeeded', 'failed', 'skipped'].includes(n.status)).length / nodes.length) * 100)
      : execution.status === 'succeeded' ? 100 : 0;

  return (
    <div className="p-8 max-w-[1100px] mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <Link
          to="/executions"
          className="inline-flex items-center gap-2 text-xs text-ink-400 hover:text-volt transition-colors mb-4"
        >
          <Icon name="arrowLeft" className="w-3.5 h-3.5" />
          All executions
        </Link>
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="font-display font-bold text-3xl tracking-tight text-ink-100 font-mono">
            {shortId(execution.id)}
          </h1>
          <StatusBadge status={execution.status} />
          <span className="tag">{execution.trigger_type}</span>
        </div>
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-ink-400 mb-1.5">
          <span className="font-display font-semibold uppercase tracking-widest">Progress</span>
          <span className="font-mono">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-ink-800 border border-ink-700 overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-700',
              execution.status === 'failed'
                ? 'bg-rose-400'
                : execution.status === 'succeeded'
                  ? 'bg-emerald-400'
                  : 'bg-volt',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* ── Meta grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Workflow', value: shortId(execution.workflow_id), mono: true },
          { label: 'Version', value: `v${execution.workflow_version}`, mono: true },
          { label: 'Initiated by', value: execution.initiated_by, mono: false },
          { label: 'Duration', value: formatDuration(execution.duration_ms), mono: true },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500">
              {item.label}
            </div>
            <div className={clsx('text-ink-100 mt-1.5 font-semibold', item.mono && 'font-mono text-sm')}>
              {item.value}
            </div>
          </Card>
        ))}
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {execution.error && (
        <div className="mb-6 rounded-md border border-rose-900/60 bg-rose-950/40 p-4">
          <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-rose-400 mb-1.5">
            Execution error
          </div>
          <pre className="font-mono text-sm text-rose-200 whitespace-pre-wrap">{execution.error}</pre>
        </div>
      )}

      {/* ── Node trace ──────────────────────────────────────────────────── */}
      <SectionTitle>Node trace · {nodes.length} nodes</SectionTitle>
      {nodes.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-ink-500">
            {execution.status === 'pending'
              ? 'Execution is queued — node trace will appear once it starts.'
              : 'No node-level trace recorded for this execution.'}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {nodes.map((node, i) => (
            <NodeTraceRow key={node.id} node={node} index={i} />
          ))}
        </div>
      )}

      {/* ── Trigger payload ─────────────────────────────────────────────── */}
      {Object.keys(execution.trigger_payload ?? {}).length > 0 && (
        <div className="mt-8">
          <SectionTitle>Trigger payload</SectionTitle>
          <Card className="p-4">
            <pre className="font-mono text-xs text-ink-300 overflow-x-auto">
              {JSON.stringify(execution.trigger_payload, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}
