/**
 * Loop API client — typed REST wrapper over the Fastify backend.
 * All requests go through the Vite dev proxy (/api → localhost:3000).
 */

export interface WorkflowDefinition {
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  metadata: { name: string; description: string; tags: string[] };
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  retry?: { max_attempts: number; backoff: string; initial_delay_ms: number };
  timeout_ms?: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  source_port?: string;
  target: string;
  target_port?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  version: number;
  status: 'draft' | 'active' | 'archived';
  tags: string[];
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused';

export interface Execution {
  id: string;
  workflow_id: string;
  workflow_version: number;
  trigger_type: 'manual' | 'cron' | 'webhook' | 'event';
  trigger_payload: Record<string, unknown>;
  status: ExecutionStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  initiated_by: string;
  nodes?: NodeExecution[];
}

export interface NodeExecution {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number;
}

export interface Trigger {
  id: string;
  workflow_id: string;
  trigger_type: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !body.success) {
    throw new ApiError(body.error?.code ?? 'HTTP_' + res.status, body.error?.message ?? res.statusText);
  }
  return body;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data;
}

/**
 * The API returns list endpoints as `{ data: T[], meta: { total, page, ... } }`.
 * Reassemble that into a flat `Paginated<T>` for convenient consumer access.
 */
function toPaginated<T>(body: ApiEnvelope<T[]>): Paginated<T> {
  const m = (body.meta ?? {}) as Record<string, unknown>;
  const data = body.data ?? [];
  return {
    data,
    total: (m['total'] as number) ?? data.length,
    page: (m['page'] as number) ?? 1,
    per_page: (m['per_page'] as number) ?? data.length,
    total_pages: (m['total_pages'] as number) ?? 1,
  };
}

export const api = {
  // ── System ──────────────────────────────────────────────────────────────
  health: () => fetch('/health').then((r) => r.json() as Promise<{ status: string }>),
  ready: () =>
    fetch('/ready').then((r) => r.json() as Promise<{ status: string; checks: Record<string, string> }>),

  // ── Workflows ───────────────────────────────────────────────────────────
  listWorkflows: (params?: { status?: string; search?: string; tag?: string; page?: number; per_page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.tag) qs.set('tag', params.tag);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    const suffix = qs.toString() ? `?${qs}` : '';
    return requestEnvelope<Workflow[]>(`/api/v1/workflows${suffix}`).then(toPaginated);
  },
  getWorkflow: (id: string) => request<Workflow>(`/api/v1/workflows/${id}`),
  createWorkflow: (payload: { name: string; description: string; definition: WorkflowDefinition; tags?: string[] }) =>
    request<Workflow>('/api/v1/workflows', { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkflow: (id: string, payload: Record<string, unknown>) =>
    request<Workflow>(`/api/v1/workflows/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  archiveWorkflow: (id: string) =>
    request<{ status: string }>(`/api/v1/workflows/${id}`, { method: 'DELETE' }),
  validateWorkflow: (id: string) =>
    request<{ valid: boolean; errors: string[]; warnings: string[] }>(`/api/v1/workflows/${id}/validate`, {
      method: 'POST',
    }),
  executeWorkflow: (id: string, payload?: Record<string, unknown>) =>
    request<{ execution_id: string; status: string }>(`/api/v1/workflows/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ payload: payload ?? {} }),
    }),

  // ── Executions ──────────────────────────────────────────────────────────
  listExecutions: (params?: { workflow_id?: string; status?: string; page?: number; per_page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.workflow_id) qs.set('workflow_id', params.workflow_id);
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    const suffix = qs.toString() ? `?${qs}` : '';
    return requestEnvelope<Execution[]>(`/api/v1/executions${suffix}`).then(toPaginated);
  },
  getExecution: (id: string) => request<Execution>(`/api/v1/executions/${id}`),
  cancelExecution: (id: string) =>
    request<{ status: string }>(`/api/v1/executions/${id}/cancel`, { method: 'POST' }),

  // ── Triggers ────────────────────────────────────────────────────────────
  listTriggers: (workflowId: string) => request<Trigger[]>(`/api/v1/workflows/${workflowId}/triggers`),
  createTrigger: (workflowId: string, trigger_type: string, config: Record<string, unknown>) =>
    request<Trigger>(`/api/v1/workflows/${workflowId}/triggers`, {
      method: 'POST',
      body: JSON.stringify({ trigger_type, config }),
    }),
};

// ── Display helpers ───────────────────────────────────────────────────────

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export const STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  pending: { color: 'text-ink-300', bg: 'bg-ink-500', label: 'Pending' },
  running: { color: 'text-volt', bg: 'bg-volt', label: 'Running' },
  succeeded: { color: 'text-good', bg: 'bg-good', label: 'Succeeded' },
  failed: { color: 'text-bad', bg: 'bg-bad', label: 'Failed' },
  cancelled: { color: 'text-warn', bg: 'bg-warn', label: 'Cancelled' },
  paused: { color: 'text-paused', bg: 'bg-paused', label: 'Paused' },
  skipped: { color: 'text-ink-400', bg: 'bg-ink-500', label: 'Skipped' },
  draft: { color: 'text-ink-300', bg: 'bg-ink-500', label: 'Draft' },
  active: { color: 'text-good', bg: 'bg-good', label: 'Active' },
  archived: { color: 'text-ink-400', bg: 'bg-ink-600', label: 'Archived' },
};

export function nodeTypeColor(type: string): string {
  const prefix = type.split('.')[0] ?? '';
  // Mid-tone hues legible on both light (paper) and dark (ink) surfaces
  const map: Record<string, string> = {
    vault: '#3b82f6',
    desk: '#10b981',
    recap: '#8b5cf6',
    control: '#f59e0b',
    code: '#ec4899',
    generic: '#78716c',
  };
  return map[prefix] ?? '#78716c';
}
