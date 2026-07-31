/**
 * Execution store (V1.1 M2, F4/F5) — global state for a live execution.
 *
 * Holds the current execution + its node rows and folds real-time WebSocket
 * events into them. The pure `reduceNodes` helper is exported so pages that
 * keep their own local state (e.g. ExecutionDetail) can apply the same stream
 * events without depending on the store instance.
 */

import { create } from 'zustand';
import { api, type Execution, type NodeExecution } from '../lib/api';
import type { ExecutionStreamEvent } from '../api/client';

export type NodeStatus = NodeExecution['status'];

/** Build a fresh node row from a stream event (used when none exists yet). */
function blankNode(event: ExecutionStreamEvent, status: NodeStatus): NodeExecution {
  const ts = event.timestamp ?? new Date().toISOString();
  return {
    id: event.nodeId ?? '',
    execution_id: event.executionId ?? '',
    node_id: event.nodeId ?? '',
    node_type: event.nodeType ?? '',
    status,
    input: {},
    output: event.output ?? {},
    error: event.error ?? null,
    started_at: status === 'running' ? ts : null,
    completed_at: status === 'running' ? null : ts,
    retry_count: 0,
  };
}

/**
 * Purely fold a single stream event into a node list (immutably). Handles the
 * initial `snapshot` (merge any previously-unseen nodes) and the per-node
 * transitions emitted by the engine EventBus.
 */
export function reduceNodes(nodes: NodeExecution[], event: ExecutionStreamEvent): NodeExecution[] {
  if (event.type === 'snapshot') {
    const byId = new Map(nodes.map((n) => [n.node_id, n]));
    for (const snap of event.nodes ?? []) {
      if (!byId.has(snap.nodeId)) {
        byId.set(snap.nodeId, {
          id: snap.nodeId,
          execution_id: event.executionId ?? '',
          node_id: snap.nodeId,
          node_type: snap.nodeType,
          status: snap.status,
          input: {},
          output: snap.output ?? {},
          error: snap.error ?? null,
          started_at: null,
          completed_at: null,
          retry_count: 0,
        });
      }
    }
    return [...byId.values()];
  }

  if (!event.nodeId) return nodes;
  const ts = event.timestamp ?? new Date().toISOString();
  const idx = nodes.findIndex((n) => n.node_id === event.nodeId);

  if (event.type === 'node_started') {
    const existing = idx >= 0 ? nodes[idx]! : null;
    const updated: NodeExecution = existing
      ? { ...existing, status: 'running', node_type: event.nodeType ?? existing.node_type, started_at: existing.started_at ?? ts }
      : blankNode(event, 'running');
    if (idx >= 0) {
      const copy = nodes.slice();
      copy[idx] = updated;
      return copy;
    }
    return [...nodes, updated];
  }

  if (event.type === 'node_succeeded' || event.type === 'node_failed' || event.type === 'node_skipped') {
    const status: NodeStatus =
      event.type === 'node_succeeded' ? 'succeeded' : event.type === 'node_failed' ? 'failed' : 'skipped';
    const existing = idx >= 0 ? nodes[idx]! : blankNode(event, status);
    const updated: NodeExecution = {
      ...existing,
      status,
      completed_at: ts,
      output: event.output ?? existing.output,
      error: event.error ?? existing.error,
    };
    if (idx >= 0) {
      const copy = nodes.slice();
      copy[idx] = updated;
      return copy;
    }
    return [...nodes, updated];
  }

  return nodes;
}

export interface ExecutionStore {
  execution: Execution | null;
  nodes: NodeExecution[];
  connected: boolean;
  error: string | null;
  setConnected: (connected: boolean) => void;
  load: (id: string) => Promise<void>;
  applyEvent: (event: ExecutionStreamEvent) => void;
  reset: () => void;
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  execution: null,
  nodes: [],
  connected: false,
  error: null,

  setConnected: (connected) => set({ connected }),

  async load(id) {
    try {
      const execution = await api.getExecution(id);
      set({ execution, nodes: execution.nodes ?? [], error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  applyEvent(event) {
    const nodes = reduceNodes(get().nodes, event);
    const execution = get().execution;
    let nextExecution = execution;
    if (execution) {
      if (event.type === 'execution_succeeded') {
        nextExecution = { ...execution, status: 'succeeded' };
      } else if (event.type === 'execution_failed') {
        nextExecution = { ...execution, status: 'failed', error: event.error ?? execution.error };
      } else if (event.type === 'snapshot' && typeof event.status === 'string') {
        nextExecution = { ...execution, status: event.status as Execution['status'] };
      }
    }
    set({ nodes, ...(nextExecution ? { execution: nextExecution } : {}) });
  },

  reset: () => set({ execution: null, nodes: [], connected: false, error: null }),
}));
