import React, { useEffect } from 'react';
import { useExecutionStore } from '../../store/executions';
import { openExecutionSocket } from '../../api/client';

interface ExecutionMonitorProps {
  executionId: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  succeeded: '#10b981',
  failed: '#ef4444',
  skipped: '#f59e0b',
};

/**
 * Live execution monitor (V1.1 M2, F5/F7).
 *
 * Loads the current execution over REST, then subscribes to
 * `WS /ws/executions/:id` and folds each pushed event into the execution store
 * so node statuses update in real time. The subscription is torn down on
 * unmount / execution change.
 */
export function ExecutionMonitor({ executionId }: ExecutionMonitorProps) {
  const execution = useExecutionStore((s) => s.execution);
  const nodes = useExecutionStore((s) => s.nodes);
  const connected = useExecutionStore((s) => s.connected);
  const error = useExecutionStore((s) => s.error);
  const load = useExecutionStore((s) => s.load);
  const applyEvent = useExecutionStore((s) => s.applyEvent);
  const setConnected = useExecutionStore((s) => s.setConnected);
  const reset = useExecutionStore((s) => s.reset);

  useEffect(() => {
    reset();
    void load(executionId);
    const socket = openExecutionSocket(executionId, applyEvent, {
      onStatus: (status) => setConnected(status === 'open'),
    });
    return () => {
      socket.close();
      reset();
    };
  }, [executionId, load, applyEvent, setConnected, reset]);

  if (error) return <div style={{ padding: '16px', color: '#ef4444' }}>{error}</div>;
  if (!execution) return <div style={{ padding: '16px' }}>Loading...</div>;

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Execution {executionId.slice(0, 8)}</h2>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            background: STATUS_COLORS[execution.status] ?? '#9ca3af',
            color: 'white',
            fontSize: '12px',
          }}
        >
          {execution.status}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '11px',
            color: connected ? '#10b981' : '#9ca3af',
          }}
        >
          {connected ? '● live' : '○ connecting'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '16px',
          fontSize: '13px',
        }}
      >
        <div>Workflow: {execution.workflow_id?.slice(0, 8)}</div>
        <div>Version: {execution.workflow_version}</div>
        <div>Trigger: {execution.trigger_type}</div>
        <div>Duration: {execution.duration_ms ? `${execution.duration_ms}ms` : '—'}</div>
      </div>

      <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Nodes</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {nodes.map((node) => (
          <div
            key={node.node_id}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: STATUS_COLORS[node.status] ?? '#9ca3af',
              }}
            />
            <span style={{ fontWeight: 500, fontSize: '13px' }}>{node.node_id}</span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>{node.node_type}</span>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
              {node.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
