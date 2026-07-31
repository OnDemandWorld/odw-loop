import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  api,
  timeAgo,
  shortId,
  nodeTypeColor,
  type Execution,
  type Workflow,
} from '../lib/api';
import { Card, Icon, LoadingBlock, SectionTitle, StatusBadge } from '../components/ui';
import { useTheme } from '../lib/theme';

interface DashboardData {
  workflows: Workflow[];
  executions: Execution[];
  ready: { status: string; checks: Record<string, string> } | null;
}

function useDashboardData(refreshKey: number) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.listWorkflows({ per_page: 100 }).catch(() => ({ data: [] as Workflow[] })),
      api.listExecutions({ per_page: 100 }).catch(() => ({ data: [] as Execution[] })),
      api.ready().catch(() => null),
    ]).then(([wf, ex, ready]) => {
      if (!alive) return;
      setData({ workflows: wf.data ?? [], executions: ex.data ?? [], ready });
      setError(null);
    }).catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return { data, error };
}

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
  delay,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: string;
  accent: string;
  delay: number;
}) {
  return (
    <Card hover className="p-5 animate-slide-up" >
      <div className="flex items-start justify-between" style={{ animationDelay: `${delay}ms` }}>
        <div>
          <div className="text-[11px] font-display font-semibold uppercase tracking-widest text-ink-400">
            {label}
          </div>
          <div className="stat-value mt-2">{value}</div>
          <div className="text-xs text-ink-400 mt-1.5 font-mono">{sub}</div>
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center border"
          style={{ background: `${accent}1a`, borderColor: `${accent}40`, color: accent }}
        >
          <Icon name={icon} className="w-5 h-5" />
        </div>
      </div>
    </Card>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: unknown;
  label?: string;
}

const ChartTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  const p = (payload as Array<{ value: number; name: string }> | undefined)?.[0];
  if (!active || !p) return null;
  return (
    <div className="panel px-3 py-2 text-xs">
      <div className="text-ink-400 font-mono">{label}</div>
      <div className="text-ink-100 font-semibold mt-0.5">{p.value} executions</div>
    </div>
  );
};

export function Dashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error } = useDashboardData(refreshKey);
  const dark = useTheme() === 'dark';

  // Recharts needs concrete color values — resolve per theme (ODW palette)
  const chart = {
    accent: dark ? '#FF5A1F' : '#E04B10',
    tick: dark ? '#8A8278' : '#6A645C',
    axis: dark ? '#2A2622' : '#D6CFC0',
    cursor: dark ? '#5A544E' : '#C4BCAC',
    cursorFill: dark ? 'rgba(246,242,236,0.05)' : 'rgba(20,17,15,0.05)',
  };

  // Auto-refresh every 15s for a live feel
  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const { workflows, executions } = data;
    const active = workflows.filter((w) => w.status === 'active').length;
    const succeeded = executions.filter((e) => e.status === 'succeeded').length;
    const failed = executions.filter((e) => e.status === 'failed').length;
    const running = executions.filter((e) => e.status === 'running').length;
    const finished = succeeded + failed;
    const successRate = finished > 0 ? Math.round((succeeded / finished) * 100) : 100;
    return { workflows, executions, active, succeeded, failed, running, successRate };
  }, [data]);

  const timeline = useMemo(() => {
    if (!data) return [];
    // Bucket executions by hour over the last 24h
    const buckets: { label: string; count: number }[] = [];
    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      const start = now - (i + 1) * 3600_000;
      const end = now - i * 3600_000;
      const count = data.executions.filter((e) => {
        const t = new Date(e.started_at ?? e.completed_at ?? now).getTime();
        return t >= start && t < end;
      }).length;
      const d = new Date(end);
      buckets.push({ label: `${String(d.getHours()).padStart(2, '0')}:00`, count });
    }
    return buckets;
  }, [data]);

  const nodeDistribution = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const wf of data.workflows) {
      for (const node of wf.definition?.nodes ?? []) {
        const prefix = node.type.split('.')[0] ?? '';
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, fill: nodeTypeColor(name) }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  if (error) {
    return (
      <div className="p-8">
        <div className="text-bad text-sm">Failed to load dashboard: {error}</div>
        <button className="btn-ghost mt-4" onClick={() => setRefreshKey((k) => k + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!data || !stats) return <LoadingBlock label="Loading dashboard…" />;

  const recent = stats.executions.slice(0, 8);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-volt mb-1.5">
            Control Plane
          </div>
          <h1 className="font-display font-bold text-3xl tracking-tight text-ink-100">
            Operations Dashboard
          </h1>
          <p className="text-sm text-ink-400 mt-1">
            Live overview of workflow orchestration across the sovereign agent suite.
          </p>
        </div>
        <button className="btn-ghost" onClick={() => setRefreshKey((k) => k + 1)}>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Workflows"
          value={stats.workflows.length}
          sub={`${stats.active} active`}
          icon="workflow"
          accent={chart.accent}
          delay={0}
        />
        <StatCard
          label="Executions"
          value={stats.executions.length}
          sub={`${stats.running} running now`}
          icon="bolt"
          accent="#8b5cf6"
          delay={60}
        />
        <StatCard
          label="Success Rate"
          value={`${stats.successRate}%`}
          sub={`${stats.succeeded} ok · ${stats.failed} failed`}
          icon="check"
          accent="#10b981"
          delay={120}
        />
        <StatCard
          label="System"
          value={data.ready ? 'Ready' : '—'}
          sub={data.ready ? Object.entries(data.ready.checks).map(([k, v]) => `${k}:${v}`).join(' · ') : 'no data'}
          icon="shield"
          accent="#f59e0b"
          delay={180}
        />
      </div>

      {/* ── Charts row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <Card className="xl:col-span-2 p-5">
          <SectionTitle>Execution volume — last 24h</SectionTitle>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="execGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fill: chart.tick, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: chart.axis }}
                  tickLine={false}
                  interval={3}
                />
                <YAxis
                  tick={{ fill: chart.tick, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: chart.cursor, strokeDasharray: '4 4' }} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={chart.accent}
                  strokeWidth={2}
                  fill="url(#execGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>Node usage by agent</SectionTitle>
          {nodeDistribution.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-ink-500">
              No workflow nodes yet
            </div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={nodeDistribution} layout="vertical" margin={{ top: 4, right: 12, left: -8, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: chart.tick, fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: chart.cursorFill }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
                    {nodeDistribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* ── Recent executions ───────────────────────────────────────────── */}
      <Card className="p-5">
        <SectionTitle
          action={
            <Link to="/executions" className="text-xs text-volt hover:underline font-medium">
              View all →
            </Link>
          }
        >
          Recent executions
        </SectionTitle>
        {recent.length === 0 ? (
          <div className="py-10 text-center text-sm text-ink-500">
            No executions yet. Trigger a workflow to see activity here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {recent.map((ex) => (
              <Link
                key={ex.id}
                to={`/executions/${ex.id}`}
                className="flex items-center gap-4 px-3 py-2.5 rounded-md border border-transparent hover:border-ink-700 hover:bg-ink-750/60 transition-all group"
              >
                <span className="font-mono text-xs text-ink-400 group-hover:text-volt transition-colors">
                  {shortId(ex.id)}
                </span>
                <span className="text-xs text-ink-500 font-mono hidden sm:block">
                  wf:{shortId(ex.workflow_id)}
                </span>
                <span className="tag">{ex.trigger_type}</span>
                <span className="ml-auto text-xs text-ink-500">
                  {ex.completed_at ? timeAgo(ex.completed_at) : ex.started_at ? timeAgo(ex.started_at) : '—'}
                </span>
                <StatusBadge status={ex.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
