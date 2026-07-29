import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatDuration, shortId, timeAgo, type Execution } from '../lib/api';
import { Card, EmptyState, Icon, LoadingBlock, StatusBadge } from '../components/ui';

export function Executions() {
  const navigate = useNavigate();
  const [executions, setExecutions] = useState<Execution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(() => {
    api
      .listExecutions({ per_page: 100 })
      .then((r) => {
        setExecutions(r.data ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(load, [load]);

  // Live refresh while any execution is running
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!executions) return [];
    if (statusFilter === 'all') return executions;
    return executions.filter((e) => e.status === statusFilter);
  }, [executions, statusFilter]);

  const filters = ['all', 'pending', 'running', 'succeeded', 'failed', 'cancelled'];

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-volt mb-1.5">Runtime</div>
          <h1 className="font-display font-bold text-3xl tracking-tight text-ink-100">Executions</h1>
          <p className="text-sm text-ink-400 mt-1">
            Every run of every workflow — trigger payloads, node traces and outcomes.
          </p>
        </div>
        <button className="btn-ghost" onClick={load}>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>

      <div className="flex gap-1.5 mb-5 flex-wrap">
        {filters.map((s) => (
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

      {error && (
        <div className="mb-4 text-sm text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded-md px-4 py-2.5">
          {error}
        </div>
      )}

      {executions === null ? (
        <LoadingBlock label="Loading executions…" />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="bolt" className="w-6 h-6" />}
            title="No executions found"
            hint="Trigger a workflow from the Workflows page and its runs will appear here in real time."
            action={
              <Link to="/workflows" className="btn-primary">
                <Icon name="workflow" />
                Go to workflows
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">Execution</th>
                <th className="th">Workflow</th>
                <th className="th">Trigger</th>
                <th className="th">Initiated by</th>
                <th className="th">Duration</th>
                <th className="th">When</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ex) => (
                <tr
                  key={ex.id}
                  className="transition-colors hover:bg-ink-750/50 cursor-pointer"
                  onClick={() => navigate(`/executions/${ex.id}`)}
                >
                  <td className="td">
                    <Link
                      to={`/executions/${ex.id}`}
                      className="font-mono text-volt hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortId(ex.id)}
                    </Link>
                  </td>
                  <td className="td font-mono text-ink-400">{shortId(ex.workflow_id)}</td>
                  <td className="td">
                    <span className="tag">{ex.trigger_type}</span>
                  </td>
                  <td className="td text-ink-400">{ex.initiated_by}</td>
                  <td className="td font-mono text-ink-300">{formatDuration(ex.duration_ms)}</td>
                  <td className="td text-ink-400">
                    {ex.completed_at
                      ? timeAgo(ex.completed_at)
                      : ex.started_at
                        ? timeAgo(ex.started_at)
                        : '—'}
                  </td>
                  <td className="td">
                    <StatusBadge status={ex.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
